export const PEERJS_URL = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
let loading;

/** Loading the optional connection service never prevents the static menu rendering. */
export function loadPeerJS() {
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
