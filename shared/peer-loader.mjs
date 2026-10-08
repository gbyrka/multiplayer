export const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
export const MULTIPLAYER_TEST_WARNING = 'The local WebRTC test did not complete. You can still try connecting. If it fails, check browser extensions, VPN or firewall settings, or try another browser.';
let loading;
let supportCheck;

function supportError(code) {
  const error = new Error(code === 'browser-incompatible' ?
    'Multiplayer is not supported in this browser: WebRTC data channels are unavailable. Please try a current Chrome, Firefox, Edge or Safari.' :
    'Multiplayer is blocked in this browser configuration. The local WebRTC test failed. Check browser extensions, VPN or browser policies, or try another browser.');
  error.code = code;
  return error;
}

/** Exchange a local data packet before contacting the CDN or signaling service. */
export function checkMultiplayerSupport() {
  if (supportCheck) return supportCheck;
  supportCheck = new Promise((resolve, reject) => {
    if (typeof globalThis.RTCPeerConnection !== 'function') {
      reject(supportError('browser-incompatible'));
      return;
    }
    let sender, receiver, channel, complete = false;
    const finish = (error, connected = true) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      try { channel?.close(); } catch { /* A browser policy may deny access. */ }
      for (const peer of [sender, receiver]) {
        if (!peer) continue;
        peer.onicecandidate = peer.ondatachannel = null;
        try { peer.close(); } catch { /* Already closed. */ }
      }
      if (error) reject(error); else resolve(connected);
    };
    const fail = () => finish(supportError('webrtc-blocked'));
    // A relay-only browser can fail a local test and still connect through TURN.
    const timer = setTimeout(() => finish(null, false), 5000);
    try {
      sender = new RTCPeerConnection({ iceServers: [] });
      receiver = new RTCPeerConnection({ iceServers: [] });
      channel = sender.createDataChannel('multiplayer-support-test', { ordered: true });
      channel.onopen = () => { try { channel.send('multiplayer-test'); } catch { fail(); } };
      channel.onmessage = event => { if (event.data === 'multiplayer-test') finish(); };
      channel.onerror = fail;
      receiver.ondatachannel = event => {
        event.channel.onmessage = message => {
          try { event.channel.send(message.data); } catch { fail(); }
        };
      };
      const pendingForSender = [], pendingForReceiver = [];
      const forwardCandidate = (peer, pending) => event => {
        if (!event.candidate || complete) return;
        if (peer.remoteDescription) peer.addIceCandidate(event.candidate).catch(fail);
        else pending.push(event.candidate);
      };
      sender.onicecandidate = forwardCandidate(receiver, pendingForReceiver);
      receiver.onicecandidate = forwardCandidate(sender, pendingForSender);
      (async () => {
        await sender.setLocalDescription(await sender.createOffer());
        if (complete) return;
        await receiver.setRemoteDescription(sender.localDescription);
        await Promise.all(pendingForReceiver.splice(0).map(candidate => receiver.addIceCandidate(candidate)));
        await receiver.setLocalDescription(await receiver.createAnswer());
        if (complete) return;
        await sender.setRemoteDescription(receiver.localDescription);
        await Promise.all(pendingForSender.splice(0).map(candidate => sender.addIceCandidate(candidate)));
      })().catch(fail);
    } catch { fail(); }
  }).catch(error => { supportCheck = null; throw error; });
  return supportCheck;
}

/** Loading the optional connection service never prevents the static menu rendering. */
export async function loadPeerJS() {
  await checkMultiplayerSupport();
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PEERJS_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    let complete = false;
    const finish = success => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      script.onload = script.onerror = null;
      if (success && globalThis.Peer) resolve(globalThis.Peer);
      else {
        script.remove();
        const error = new Error("We couldn't load the connection library. Please check your internet connection and reload the page.");
        error.code = 'LIBRARY_UNAVAILABLE';
        reject(error);
      }
    };
    const timeout = setTimeout(() => finish(false), 20000);
    script.onload = () => finish(true);
    script.onerror = () => finish(false);
    document.head.append(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}
