/* Voice and video calls between the two players in a room (WebRTC, peer to peer).
 * Signalling goes through the server's 'rtc' relay. Uses the "perfect negotiation"
 * pattern: the person who answers is the polite peer.
 */
(function () {
  'use strict';

  const CT = window.CT;
  const { $, toast, sound } = CT.ui;
  const net = CT.net;

  const RING_TIMEOUT_MS = 35000;

  const els = {
    dock: $('#call'),
    remote: $('#remote-video'),
    local: $('#local-video'),
    avatar: $('#remote-avatar'),
    state: $('#call-state'),
    mic: $('#mic-btn'),
    cam: $('#cam-btn'),
    end: $('#end-btn'),
    min: $('#call-min-btn'),
    size: $('#call-size-btn'),
    incoming: $('#incoming'),
    incomingText: $('#incoming-text'),
  };

  const call = {
    state: 'idle', // idle | calling | ringing | live
    pc: null,
    local: null,
    video: false,
    polite: false,
    makingOffer: false,
    ignoreOffer: false,
    iceServers: null,
    ringTimer: null,
    ringSound: null,
    opponentName: 'Your friend',
  };

  function setState(state, label) {
    call.state = state;
    els.state.textContent = label || '';
    document.dispatchEvent(new CustomEvent('ct:call', { detail: state }));
  }

  async function getIceServers() {
    const res = await net.request('ice');
    const servers = res && Array.isArray(res.iceServers) && res.iceServers.length ? res.iceServers : [{ urls: 'stun:stun.l.google.com:19302' }];
    // Relay credentials expire, so only keep them for this call.
    return servers;
  }

  function mediaError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera and microphone are blocked. Allow them in your browser settings, then try again.';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera or microphone found on this device.';
    if (name === 'NotReadableError') return 'Your camera or microphone is being used by another app.';
    return 'Could not start your camera or microphone.';
  }

  async function getMedia(wantVideo) {
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('insecure'), { name: 'Insecure' });
    }
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (!wantVideo) return navigator.mediaDevices.getUserMedia({ audio, video: false });
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
    } catch (err) {
      // No camera or camera refused: fall back to voice.
      if (err.name === 'NotFoundError' || err.name === 'NotReadableError' || err.name === 'OverconstrainedError') {
        toast('Camera not available. Starting a voice call.');
        return navigator.mediaDevices.getUserMedia({ audio, video: false });
      }
      throw err;
    }
  }

  function insecureMessage() {
    return 'Calls need a secure link. Open the app on its https:// address (or on localhost on this computer).';
  }

  function showDock() {
    const hasVideo = !!(call.local && call.local.getVideoTracks().length);
    els.dock.dataset.video = String(hasVideo || call.remoteHasVideo === true);
    els.cam.hidden = !hasVideo;
    els.local.hidden = !hasVideo;
    els.avatar.textContent = (call.opponentName || '?').slice(0, 1).toUpperCase();
    els.avatar.hidden = call.remoteHasVideo === true;
    els.dock.hidden = false;
    applySize();
  }

  // Size of the call window: 'large' (default), 'small', or minimised (video hidden).
  let size = CT.ui.store.get('callSize', 'large') === 'small' ? 'small' : 'large';

  function applySize() {
    const min = els.dock.classList.contains('min');
    els.dock.classList.toggle('large', size === 'large' && !min);
    document.body.dataset.call = min ? 'min' : size === 'large' ? 'large' : 'on';
    els.size.setAttribute('aria-pressed', String(size === 'large'));
    els.size.setAttribute('aria-label', size === 'large' ? 'Make video smaller' : 'Make video bigger');
    els.size.hidden = min;
  }

  function setSize(next) {
    size = next;
    CT.ui.store.set('callSize', size);
    els.dock.classList.remove('min');
    els.min.setAttribute('aria-pressed', 'false');
    els.min.setAttribute('aria-label', 'Hide video');
    applySize();
  }

  function attachLocal() {
    els.local.srcObject = call.local;
    els.local.play().catch(() => {});
  }

  function createPeer(iceServers) {
    const pc = new RTCPeerConnection({ iceServers });
    call.pc = pc;
    call.remoteHasVideo = false;

    for (const track of call.local.getTracks()) pc.addTrack(track, call.local);

    pc.onnegotiationneeded = async () => {
      // The caller always makes the first offer; the answering side waits for it.
      // Two offers crossing on the wire is what made some first calls hang.
      if (call.polite && !pc.remoteDescription) return;
      try {
        call.makingOffer = true;
        await pc.setLocalDescription();
        net.send('rtc', { type: 'description', payload: pc.localDescription.toJSON() });
      } catch (err) {
        console.warn('[call] offer failed', err);
      } finally {
        call.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) net.send('rtc', { type: 'candidate', payload: candidate.toJSON() });
    };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      if (els.remote.srcObject !== stream) els.remote.srcObject = stream;
      if (track.kind === 'video') {
        call.remoteHasVideo = true;
        track.onmute = () => (els.avatar.hidden = false);
        track.onunmute = () => (els.avatar.hidden = true);
      }
      showDock();
      els.remote.play().catch(() => {
        setState(call.state, 'Tap the call window to hear your friend');
        els.dock.addEventListener('click', () => els.remote.play().catch(() => {}), { once: true });
      });
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') setState('live', '');
      else if (s === 'disconnected') setState('live', 'Reconnecting…');
      else if (s === 'failed') {
        toast('The call could not connect. On mobile data this usually needs a relay (TURN) server.', { tone: 'bad', ms: 6000 });
        end(true);
      }
    };
    return pc;
  }

  async function onDescription(desc) {
    const pc = call.pc;
    if (!pc) return;
    try {
      const collision = desc.type === 'offer' && (call.makingOffer || pc.signalingState !== 'stable');
      call.ignoreOffer = !call.polite && collision;
      if (call.ignoreOffer) return;
      await pc.setRemoteDescription(desc);
      if (desc.type === 'offer') {
        await pc.setLocalDescription();
        net.send('rtc', { type: 'description', payload: pc.localDescription.toJSON() });
      }
    } catch (err) {
      console.warn('[call] description failed', err);
    }
  }

  async function onCandidate(candidate) {
    if (!call.pc) return;
    try {
      await call.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!call.ignoreOffer) console.warn('[call] candidate failed', err);
    }
  }

  function stopRinging() {
    clearTimeout(call.ringTimer);
    clearInterval(call.ringSound);
    call.ringTimer = null;
    call.ringSound = null;
    els.incoming.hidden = true;
  }

  function end(notify) {
    if (notify && call.state !== 'idle') net.send('rtc', { type: 'end' });
    stopRinging();
    if (call.pc) {
      call.pc.onconnectionstatechange = null;
      call.pc.close();
    }
    call.pc = null;
    if (call.local) call.local.getTracks().forEach((t) => t.stop());
    call.local = null;
    els.remote.srcObject = null;
    els.local.srcObject = null;
    els.dock.hidden = true;
    els.dock.classList.remove('min', 'large');
    els.min.setAttribute('aria-pressed', 'false');
    delete document.body.dataset.call;
    els.mic.setAttribute('aria-pressed', 'false');
    els.cam.setAttribute('aria-pressed', 'false');
    setState('idle', '');
  }

  // ---------------------------------------------------------------- public actions

  async function start(wantVideo) {
    if (call.state !== 'idle') return;
    if (!net.room) return toast('Join a room first.');
    if (!window.isSecureContext) return toast(insecureMessage(), { tone: 'bad', ms: 6000 });
    try {
      call.local = await getMedia(wantVideo);
    } catch (err) {
      return toast(err.name === 'Insecure' ? insecureMessage() : mediaError(err), { tone: 'bad', ms: 6000 });
    }
    call.polite = false;
    attachLocal();
    setState('calling', `Calling ${call.opponentName}…`);
    showDock();
    net.send('rtc', { type: 'invite', video: call.local.getVideoTracks().length > 0 });
    call.ringTimer = setTimeout(() => {
      if (call.state === 'calling') {
        toast(`${call.opponentName} did not answer.`);
        end(true);
      }
    }, RING_TIMEOUT_MS);
  }

  async function accept(wantVideo) {
    if (call.state !== 'ringing') return;
    stopRinging();
    try {
      call.local = await getMedia(wantVideo);
    } catch (err) {
      toast(err.name === 'Insecure' ? insecureMessage() : mediaError(err), { tone: 'bad', ms: 6000 });
      net.send('rtc', { type: 'decline' });
      return end(false);
    }
    call.polite = true;
    attachLocal();
    setState('live', 'Connecting…');
    showDock();
    createPeer(await getIceServers());
    net.send('rtc', { type: 'accept' });
  }

  function decline() {
    if (call.state !== 'ringing') return;
    net.send('rtc', { type: 'decline' });
    end(false);
  }

  // ---------------------------------------------------------------- signalling

  net.socket.on('rtc', async (msg) => {
    switch (msg.type) {
      case 'invite':
        if (call.state !== 'idle') {
          net.send('rtc', { type: 'decline' });
          return;
        }
        setState('ringing', '');
        els.incomingText.textContent = `${call.opponentName} is calling you${msg.video ? ' (video)' : ''}.`;
        els.incoming.hidden = false;
        sound.ring();
        call.ringSound = setInterval(() => sound.ring(), 2200);
        call.ringTimer = setTimeout(() => end(false), RING_TIMEOUT_MS);
        break;
      case 'accept':
        if (call.state !== 'calling') return;
        clearTimeout(call.ringTimer);
        setState('live', 'Connecting…');
        createPeer(await getIceServers());
        break;
      case 'decline':
        if (call.state === 'calling') toast(`${call.opponentName} cannot take a call right now.`);
        end(false);
        break;
      case 'unavailable':
        toast(`${call.opponentName} is not in the room.`);
        end(false);
        break;
      case 'end':
        if (call.state !== 'idle') toast('Call ended.');
        end(false);
        break;
      case 'description':
        if (msg.payload) onDescription(msg.payload);
        break;
      case 'candidate':
        if (msg.payload) onCandidate(msg.payload);
        break;
    }
  });

  // ---------------------------------------------------------------- controls

  els.mic.addEventListener('click', () => {
    if (!call.local) return;
    const muted = els.mic.getAttribute('aria-pressed') !== 'true';
    call.local.getAudioTracks().forEach((t) => (t.enabled = !muted));
    els.mic.setAttribute('aria-pressed', String(muted));
    els.mic.setAttribute('aria-label', muted ? 'Unmute microphone' : 'Mute microphone');
  });

  els.cam.addEventListener('click', () => {
    if (!call.local) return;
    const off = els.cam.getAttribute('aria-pressed') !== 'true';
    call.local.getVideoTracks().forEach((t) => (t.enabled = !off));
    els.cam.setAttribute('aria-pressed', String(off));
    els.cam.setAttribute('aria-label', off ? 'Turn camera on' : 'Turn camera off');
  });

  els.end.addEventListener('click', () => end(true));

  els.min.addEventListener('click', () => {
    const min = els.dock.classList.toggle('min');
    els.min.setAttribute('aria-pressed', String(min));
    els.min.setAttribute('aria-label', min ? 'Show video' : 'Hide video');
    applySize();
  });

  els.size.addEventListener('click', () => setSize(size === 'large' ? 'small' : 'large'));
  // Tapping the video also switches between big and small.
  els.dock.querySelector('.call-media').addEventListener('click', () => {
    if (call.state !== 'idle') setSize(size === 'large' ? 'small' : 'large');
  });

  $('#incoming-accept').addEventListener('click', () => accept(true));
  $('#incoming-audio').addEventListener('click', () => accept(false));
  $('#incoming-decline').addEventListener('click', decline);

  window.addEventListener('pagehide', () => end(true));
  net.bus.addEventListener('room', (e) => {
    if (!e.detail) end(false);
  });

  CT.call = {
    start,
    end: () => end(true),
    get state() {
      return call.state;
    },
    setOpponentName(name) {
      call.opponentName = name || 'Your friend';
    },
  };
})();
