/**
 * WebRTCManager — peer-to-peer voice/video calling for Chess Together.
 *
 * Handles media capture, RTCPeerConnection lifecycle, Socket.IO signaling,
 * UI button wiring, draggable video overlay, and graceful cleanup.
 *
 * Usage:
 *   const rtc = new WebRTCManager(socket, roomId);
 *   await rtc.startCall(true);   // true = with video
 *   rtc.destroy();               // full teardown
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Constants                                                          */
  /* ------------------------------------------------------------------ */

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];

  /** Delay before attempting an automatic re-offer after a transient failure. */
  const RECONNECT_DELAY_MS = 3000;

  /** Maximum automatic reconnection attempts before giving up. */
  const MAX_RECONNECT_ATTEMPTS = 3;

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Safely attach a MediaStream to a <video>/<audio> element, handling
   * the webkit-prefixed `srcObject` path and autoplay policies.
   */
  function attachStream(element, stream) {
    if (!element) return;
    if ('srcObject' in element) {
      element.srcObject = stream;
    } else {
      // Fallback for very old browsers
      element.src = URL.createObjectURL(stream);
    }
    element.play().catch(function () {
      /* Autoplay blocked — user interaction will unblock it */
    });
  }

  /**
   * Stop every track in a MediaStream and release resources.
   */
  function stopStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach(function (track) {
      track.stop();
    });
  }

  /**
   * Query an element, returning null silently if missing.
   */
  function $(selector) {
    return document.querySelector(selector);
  }

  /* ------------------------------------------------------------------ */
  /*  WebRTCManager                                                      */
  /* ------------------------------------------------------------------ */

  /**
   * @constructor
   * @param {object} socket  - Socket.IO client instance.
   * @param {string} roomId  - The room both peers have joined.
   */
  function WebRTCManager(socket, roomId) {
    this.socket = socket;
    this.roomId = roomId;

    /** @type {RTCPeerConnection|null} */
    this.pc = null;

    /** @type {MediaStream|null} */
    this.localStream = null;

    /** @type {MediaStream|null} */
    this.remoteStream = null;

    /** Whether this peer is the offer initiator. */
    this.isInitiator = false;

    /** Whether a call is currently active (or being set up). */
    this.callActive = false;

    /** Current connection state label shown in the UI. */
    this.connectionState = 'idle'; // idle | connecting | connected | disconnected | failed

    /** Audio enabled flag. */
    this.audioEnabled = true;

    /** Video enabled flag. */
    this.videoEnabled = true;

    /** Reconnection attempt counter. */
    this._reconnectAttempts = 0;

    /** Reconnect timer handle. */
    this._reconnectTimer = null;

    /** Whether the negotiation-needed handler should fire (avoids loops). */
    this._makingOffer = false;

    /** Polite peer flag — the non-initiator is polite (handles glare). */
    this._isPolite = false;

    /** Ignore subsequent offers while processing one (glare guard). */
    this._ignoreOffer = false;

    /** Bound handler references for clean removal. */
    this._boundHandlers = {};

    // ---- Socket signaling listeners ----
    this._bindSocketListeners();

    // ---- UI button wiring ----
    this._bindUIButtons();
  }

  /* ================================================================== */
  /*  Public API                                                         */
  /* ================================================================== */

  /**
   * Start a call, requesting user media and (if initiator) sending an offer.
   *
   * @param {boolean} [withVideo=true]  Request video in addition to audio.
   * @returns {Promise<void>}
   */
  WebRTCManager.prototype.startCall = async function startCall(withVideo) {
    if (typeof withVideo === 'undefined') withVideo = true;

    this.isInitiator = true;
    this._isPolite = false;
    this.callActive = true;
    this.videoEnabled = withVideo;

    this._setConnectionState('connecting');

    // ---- Create the peer connection ----
    this._createPeerConnection();

    // ---- Acquire local media ----
    try {
      this.localStream = await this._getUserMedia(withVideo);
    } catch (err) {
      this._handleMediaError(err);
      return;
    }

    // Attach local preview
    attachStream($('#local-video'), this.localStream);

    // Add tracks to the connection
    this.localStream.getTracks().forEach(function (track) {
      this.pc.addTrack(track, this.localStream);
    }.bind(this));

    // Show video container
    this._showVideoContainer(true);

    // Create and send the offer
    await this._createAndSendOffer();
  };

  /**
   * Toggle microphone on/off.
   * @returns {boolean} New enabled state.
   */
  WebRTCManager.prototype.toggleAudio = function toggleAudio() {
    if (!this.localStream) return this.audioEnabled;

    this.audioEnabled = !this.audioEnabled;

    this.localStream.getAudioTracks().forEach(function (track) {
      track.enabled = this.audioEnabled;
    }.bind(this));

    this._updateToggleButton('#toggle-audio', this.audioEnabled, '🎤', '🔇');
    return this.audioEnabled;
  };

  /**
   * Toggle camera on/off.
   * @returns {boolean} New enabled state.
   */
  WebRTCManager.prototype.toggleVideo = function toggleVideo() {
    if (!this.localStream) return this.videoEnabled;

    this.videoEnabled = !this.videoEnabled;

    this.localStream.getVideoTracks().forEach(function (track) {
      track.enabled = this.videoEnabled;
    }.bind(this));

    this._updateToggleButton('#toggle-video', this.videoEnabled, '📹', '📷');
    return this.videoEnabled;
  };

  /**
   * End the current call: stop streams, close the connection, hide UI.
   */
  WebRTCManager.prototype.endCall = function endCall() {
    this.callActive = false;
    this._clearReconnectTimer();

    // Stop local tracks
    stopStream(this.localStream);
    this.localStream = null;

    // Stop remote tracks
    stopStream(this.remoteStream);
    this.remoteStream = null;

    // Clear video elements
    this._detachVideo('#local-video');
    this._detachVideo('#remote-video');

    // Close peer connection
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    this._showVideoContainer(false);
    this._setConnectionState('idle');

    // Reset buttons
    this.audioEnabled = true;
    this.videoEnabled = true;
    this._updateToggleButton('#toggle-audio', true, '🎤', '🔇');
    this._updateToggleButton('#toggle-video', true, '📹', '📷');
  };

  /**
   * Full cleanup: end any active call, remove all event listeners,
   * and sever the reference to the socket.
   */
  WebRTCManager.prototype.destroy = function destroy() {
    this.endCall();
    this._unbindSocketListeners();
    this._unbindUIButtons();
    this.socket = null;
  };

  /* ================================================================== */
  /*  Peer Connection Setup                                              */
  /* ================================================================== */

  /**
   * Create a fresh RTCPeerConnection and wire up its event handlers.
   * @private
   */
  WebRTCManager.prototype._createPeerConnection = function _createPeerConnection() {
    if (this.pc) {
      this.pc.close();
    }

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // ---- ICE candidates ----
    this.pc.onicecandidate = function (event) {
      if (event.candidate && this.socket) {
        this.socket.emit('ice-candidate', {
          roomId: this.roomId,
          candidate: event.candidate,
        });
      }
    }.bind(this);

    // ---- Remote track arrival ----
    this.pc.ontrack = function (event) {
      if (!this.remoteStream) {
        this.remoteStream = new MediaStream();
        attachStream($('#remote-video'), this.remoteStream);
      }
      this.remoteStream.addTrack(event.track);
    }.bind(this);

    // ---- Connection state monitoring ----
    this.pc.oniceconnectionstatechange = function () {
      this._onIceConnectionStateChange();
    }.bind(this);

    this.pc.onconnectionstatechange = function () {
      this._onConnectionStateChange();
    }.bind(this);

    // ---- Negotiation needed (renegotiation) ----
    this.pc.onnegotiationneeded = async function () {
      if (!this.isInitiator) return; // only initiator renegotiates
      await this._createAndSendOffer();
    }.bind(this);
  };

  /* ================================================================== */
  /*  Signaling                                                          */
  /* ================================================================== */

  /**
   * Create an SDP offer, set it as local description, and send via socket.
   * @private
   */
  WebRTCManager.prototype._createAndSendOffer = async function _createAndSendOffer() {
    if (!this.pc || !this.socket) return;

    try {
      this._makingOffer = true;
      var offer = await this.pc.createOffer();
      // Guard against racing state changes
      if (this.pc.signalingState !== 'stable') return;
      await this.pc.setLocalDescription(offer);
      this.socket.emit('offer', {
        roomId: this.roomId,
        sdp: this.pc.localDescription,
      });
    } catch (err) {
      console.error('[WebRTC] Failed to create offer:', err);
    } finally {
      this._makingOffer = false;
    }
  };

  /**
   * Handle an incoming SDP offer: set up media if needed, set remote
   * description, create an answer, and send it.
   * @private
   * @param {RTCSessionDescriptionInit} sdp
   */
  WebRTCManager.prototype._handleOffer = async function _handleOffer(sdp) {
    if (!this.socket) return;

    // ---- Perfect negotiation glare handling ----
    var offerCollision =
      this._makingOffer ||
      (this.pc && this.pc.signalingState !== 'stable');

    this._ignoreOffer = !this._isPolite && offerCollision;
    if (this._ignoreOffer) return;

    // We are the answerer; ensure we have a peer connection and local media
    if (!this.pc) {
      this._isPolite = true;
      this.isInitiator = false;
      this.callActive = true;
      this._setConnectionState('connecting');
      this._createPeerConnection();
    }

    // Acquire local media if we haven't yet (callee side)
    if (!this.localStream) {
      try {
        this.localStream = await this._getUserMedia(true);
      } catch (_) {
        // Fall back to audio-only
        try {
          this.localStream = await this._getUserMedia(false);
          this.videoEnabled = false;
        } catch (err) {
          this._handleMediaError(err);
          return;
        }
      }

      attachStream($('#local-video'), this.localStream);

      this.localStream.getTracks().forEach(function (track) {
        this.pc.addTrack(track, this.localStream);
      }.bind(this));

      this._showVideoContainer(true);
    }

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      var answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.socket.emit('answer', {
        roomId: this.roomId,
        sdp: this.pc.localDescription,
      });
    } catch (err) {
      console.error('[WebRTC] Failed to handle offer:', err);
    }
  };

  /**
   * Handle an incoming SDP answer.
   * @private
   * @param {RTCSessionDescriptionInit} sdp
   */
  WebRTCManager.prototype._handleAnswer = async function _handleAnswer(sdp) {
    if (!this.pc) return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    } catch (err) {
      console.error('[WebRTC] Failed to set remote description (answer):', err);
    }
  };

  /**
   * Handle an incoming ICE candidate from the remote peer.
   * @private
   * @param {RTCIceCandidateInit} candidate
   */
  WebRTCManager.prototype._handleIceCandidate = async function _handleIceCandidate(candidate) {
    if (!this.pc) return;
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      if (!this._ignoreOffer) {
        console.error('[WebRTC] Failed to add ICE candidate:', err);
      }
    }
  };

  /* ================================================================== */
  /*  Connection State                                                   */
  /* ================================================================== */

  /** @private */
  WebRTCManager.prototype._onIceConnectionStateChange = function _onIceConnectionStateChange() {
    if (!this.pc) return;
    var state = this.pc.iceConnectionState;
    console.log('[WebRTC] ICE connection state:', state);

    switch (state) {
      case 'checking':
        this._setConnectionState('connecting');
        break;
      case 'connected':
      case 'completed':
        this._setConnectionState('connected');
        this._reconnectAttempts = 0;
        break;
      case 'disconnected':
        this._setConnectionState('disconnected');
        this._scheduleReconnect();
        break;
      case 'failed':
        this._setConnectionState('failed');
        this._scheduleReconnect();
        break;
      case 'closed':
        this._setConnectionState('idle');
        break;
    }
  };

  /** @private */
  WebRTCManager.prototype._onConnectionStateChange = function _onConnectionStateChange() {
    if (!this.pc) return;
    console.log('[WebRTC] Connection state:', this.pc.connectionState);

    if (this.pc.connectionState === 'failed') {
      this._setConnectionState('failed');
      this._scheduleReconnect();
    }
  };

  /**
   * Update the internal state label and push it to the UI indicator.
   * @private
   * @param {string} state
   */
  WebRTCManager.prototype._setConnectionState = function _setConnectionState(state) {
    this.connectionState = state;

    var indicator = $('#call-status');
    if (!indicator) return;

    var labels = {
      idle: '',
      connecting: '🔄 Connecting…',
      connected: '🟢 Connected',
      disconnected: '🟡 Reconnecting…',
      failed: '🔴 Connection lost',
    };

    indicator.textContent = labels[state] || '';
    indicator.className = 'call-status call-status--' + state;
  };

  /* ================================================================== */
  /*  Auto-Reconnect                                                     */
  /* ================================================================== */

  /** @private */
  WebRTCManager.prototype._scheduleReconnect = function _scheduleReconnect() {
    if (!this.callActive) return;
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[WebRTC] Max reconnect attempts reached.');
      this._setConnectionState('failed');
      return;
    }

    this._clearReconnectTimer();

    this._reconnectAttempts++;
    console.log(
      '[WebRTC] Scheduling reconnect attempt',
      this._reconnectAttempts,
      'in',
      RECONNECT_DELAY_MS,
      'ms'
    );

    this._reconnectTimer = setTimeout(
      function () {
        this._attemptReconnect();
      }.bind(this),
      RECONNECT_DELAY_MS
    );
  };

  /** @private */
  WebRTCManager.prototype._attemptReconnect = async function _attemptReconnect() {
    if (!this.callActive || !this.isInitiator) return;

    console.log('[WebRTC] Attempting ICE restart…');

    // Restart ICE on the existing connection
    if (this.pc) {
      try {
        var offer = await this.pc.createOffer({ iceRestart: true });
        await this.pc.setLocalDescription(offer);
        if (this.socket) {
          this.socket.emit('offer', {
            roomId: this.roomId,
            sdp: this.pc.localDescription,
          });
        }
      } catch (err) {
        console.error('[WebRTC] ICE restart failed:', err);
      }
    }
  };

  /** @private */
  WebRTCManager.prototype._clearReconnectTimer = function _clearReconnectTimer() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  };

  /* ================================================================== */
  /*  Media Helpers                                                      */
  /* ================================================================== */

  /**
   * Wrapper around getUserMedia with graceful fallback.
   * @private
   * @param {boolean} withVideo
   * @returns {Promise<MediaStream>}
   */
  WebRTCManager.prototype._getUserMedia = function _getUserMedia(withVideo) {
    var constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: withVideo
        ? { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } }
        : false,
    };

    // Normalize across browser prefixes
    var gum =
      navigator.mediaDevices && navigator.mediaDevices.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        : null;

    if (!gum) {
      // Legacy path
      var legacyGum =
        navigator.getUserMedia ||
        navigator.webkitGetUserMedia ||
        navigator.mozGetUserMedia ||
        navigator.msGetUserMedia;

      if (!legacyGum) {
        return Promise.reject(new Error('getUserMedia is not supported in this browser.'));
      }

      return new Promise(function (resolve, reject) {
        legacyGum.call(navigator, constraints, resolve, reject);
      });
    }

    return gum(constraints);
  };

  /**
   * Present a user-friendly message when media access fails.
   * @private
   * @param {Error} err
   */
  WebRTCManager.prototype._handleMediaError = function _handleMediaError(err) {
    console.error('[WebRTC] Media error:', err);

    var msg;
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        msg = 'Camera/microphone access was denied. Please allow access in your browser settings.';
        break;
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        msg = 'No camera or microphone found on this device.';
        break;
      case 'NotReadableError':
      case 'TrackStartError':
        msg = 'Your camera or microphone is already in use by another app.';
        break;
      case 'OverconstrainedError':
        msg = 'Could not satisfy media constraints. Trying audio-only…';
        break;
      default:
        msg = 'Could not access media devices: ' + (err.message || err.name);
    }

    this._setConnectionState('failed');

    // Show a toast/alert (integrate with app's notification system if available)
    var toast = $('#call-toast');
    if (toast) {
      toast.textContent = msg;
      toast.style.display = 'block';
      setTimeout(function () {
        toast.style.display = 'none';
      }, 5000);
    } else {
      alert(msg);
    }
  };

  /**
   * Detach stream from a video element and release the object URL if used.
   * @private
   * @param {string} selector
   */
  WebRTCManager.prototype._detachVideo = function _detachVideo(selector) {
    var el = $(selector);
    if (!el) return;
    el.pause();
    if ('srcObject' in el) {
      el.srcObject = null;
    } else if (el.src) {
      URL.revokeObjectURL(el.src);
      el.src = '';
    }
  };

  /* ================================================================== */
  /*  Socket Listeners                                                   */
  /* ================================================================== */

  /** @private */
  WebRTCManager.prototype._bindSocketListeners = function _bindSocketListeners() {
    var self = this;

    this._boundHandlers._onOffer = function (data) {
      if (data.roomId === self.roomId) self._handleOffer(data.sdp);
    };
    this._boundHandlers._onAnswer = function (data) {
      if (data.roomId === self.roomId) self._handleAnswer(data.sdp);
    };
    this._boundHandlers._onIceCandidate = function (data) {
      if (data.roomId === self.roomId) self._handleIceCandidate(data.candidate);
    };

    this.socket.on('offer', this._boundHandlers._onOffer);
    this.socket.on('answer', this._boundHandlers._onAnswer);
    this.socket.on('ice-candidate', this._boundHandlers._onIceCandidate);

    // Clean up on page unload
    this._boundHandlers._onBeforeUnload = function () {
      self.destroy();
    };
    window.addEventListener('beforeunload', this._boundHandlers._onBeforeUnload);
  };

  /** @private */
  WebRTCManager.prototype._unbindSocketListeners = function _unbindSocketListeners() {
    if (this.socket) {
      this.socket.off('offer', this._boundHandlers._onOffer);
      this.socket.off('answer', this._boundHandlers._onAnswer);
      this.socket.off('ice-candidate', this._boundHandlers._onIceCandidate);
    }
    window.removeEventListener('beforeunload', this._boundHandlers._onBeforeUnload);
  };

  /* ================================================================== */
  /*  UI Integration                                                     */
  /* ================================================================== */

  /** @private */
  WebRTCManager.prototype._bindUIButtons = function _bindUIButtons() {
    var self = this;

    this._boundHandlers._toggleAudioClick = function () { self.toggleAudio(); };
    this._boundHandlers._toggleVideoClick = function () { self.toggleVideo(); };
    this._boundHandlers._endCallClick = function () { self.endCall(); };

    var btnAudio = $('#toggle-audio');
    var btnVideo = $('#toggle-video');
    var btnEnd = $('#end-call');

    if (btnAudio) btnAudio.addEventListener('click', this._boundHandlers._toggleAudioClick);
    if (btnVideo) btnVideo.addEventListener('click', this._boundHandlers._toggleVideoClick);
    if (btnEnd) btnEnd.addEventListener('click', this._boundHandlers._endCallClick);

    // Set initial button labels
    this._updateToggleButton('#toggle-audio', true, '🎤', '🔇');
    this._updateToggleButton('#toggle-video', true, '📹', '📷');

    var endBtn = $('#end-call');
    if (endBtn && !endBtn.textContent.trim()) endBtn.textContent = '📞';

    // ---- Make video container draggable on touch ----
    this._initDraggable();
  };

  /** @private */
  WebRTCManager.prototype._unbindUIButtons = function _unbindUIButtons() {
    var btnAudio = $('#toggle-audio');
    var btnVideo = $('#toggle-video');
    var btnEnd = $('#end-call');

    if (btnAudio) btnAudio.removeEventListener('click', this._boundHandlers._toggleAudioClick);
    if (btnVideo) btnVideo.removeEventListener('click', this._boundHandlers._toggleVideoClick);
    if (btnEnd) btnEnd.removeEventListener('click', this._boundHandlers._endCallClick);

    this._destroyDraggable();
  };

  /**
   * Update a toggle button's text/icon.
   * @private
   */
  WebRTCManager.prototype._updateToggleButton = function _updateToggleButton(
    selector,
    enabled,
    onIcon,
    offIcon
  ) {
    var btn = $(selector);
    if (!btn) return;
    btn.textContent = enabled ? onIcon : offIcon;
    btn.setAttribute('aria-pressed', String(!enabled));
    btn.title = enabled
      ? selector.includes('audio') ? 'Mute microphone' : 'Turn off camera'
      : selector.includes('audio') ? 'Unmute microphone' : 'Turn on camera';
  };

  /**
   * Show or hide the floating video container.
   * @private
   * @param {boolean} visible
   */
  WebRTCManager.prototype._showVideoContainer = function _showVideoContainer(visible) {
    var container = $('#video-container');
    if (!container) return;
    container.style.display = visible ? 'flex' : 'none';
  };

  /* ================================================================== */
  /*  Draggable Video Container (Touch + Mouse)                          */
  /* ================================================================== */

  /** @private */
  WebRTCManager.prototype._initDraggable = function _initDraggable() {
    var container = $('#video-container');
    if (!container) return;

    var self = this;
    var startX, startY, origX, origY, dragging;

    function pointerDown(e) {
      // Only allow dragging from the container background or the drag handle,
      // not from buttons or video elements.
      var tag = e.target.tagName.toLowerCase();
      if (tag === 'button' || tag === 'video') return;

      dragging = true;
      var point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;

      var rect = container.getBoundingClientRect();
      origX = rect.left;
      origY = rect.top;

      e.preventDefault();
    }

    function pointerMove(e) {
      if (!dragging) return;
      var point = e.touches ? e.touches[0] : e;
      var dx = point.clientX - startX;
      var dy = point.clientY - startY;

      // Clamp within viewport
      var newX = Math.max(0, Math.min(window.innerWidth - container.offsetWidth, origX + dx));
      var newY = Math.max(0, Math.min(window.innerHeight - container.offsetHeight, origY + dy));

      container.style.left = newX + 'px';
      container.style.top = newY + 'px';
      // Override any CSS right/bottom positioning
      container.style.right = 'auto';
      container.style.bottom = 'auto';
      container.style.position = 'fixed';
    }

    function pointerUp() {
      dragging = false;
    }

    container.addEventListener('touchstart', pointerDown, { passive: false });
    container.addEventListener('mousedown', pointerDown);
    document.addEventListener('touchmove', pointerMove, { passive: false });
    document.addEventListener('mousemove', pointerMove);
    document.addEventListener('touchend', pointerUp);
    document.addEventListener('mouseup', pointerUp);

    // Store references for teardown
    self._drag = {
      el: container,
      pointerDown: pointerDown,
      pointerMove: pointerMove,
      pointerUp: pointerUp,
    };
  };

  /** @private */
  WebRTCManager.prototype._destroyDraggable = function _destroyDraggable() {
    var d = this._drag;
    if (!d) return;

    d.el.removeEventListener('touchstart', d.pointerDown);
    d.el.removeEventListener('mousedown', d.pointerDown);
    document.removeEventListener('touchmove', d.pointerMove);
    document.removeEventListener('mousemove', d.pointerMove);
    document.removeEventListener('touchend', d.pointerUp);
    document.removeEventListener('mouseup', d.pointerUp);

    this._drag = null;
  };

  /* ================================================================== */
  /*  Expose                                                             */
  /* ================================================================== */

  window.WebRTCManager = WebRTCManager;
})();
