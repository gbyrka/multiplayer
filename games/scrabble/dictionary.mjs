import { readDictionary } from '../boggle/dictionary.mjs';
const cache = new Map();
export function loadDictionary(language) {
  if (!['pl','en'].includes(language)) return Promise.reject(new Error('Unknown dictionary.'));
  if (!cache.has(language)) {
    const task = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(new URL(`../boggle/data/${language}.bin.gz?v=boggle1`, import.meta.url), { signal: controller.signal });
        if (!response.ok) throw new Error('Dictionary download failed. Please retry.');
        if (typeof DecompressionStream !== 'function') throw new Error('Please update your browser to load the dictionary.');
        const data = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        return readDictionary(data);
      } finally { clearTimeout(timer); }
    })().catch(error => { cache.delete(language); throw error; });
    cache.set(language, task);
  }
  return cache.get(language);
}
