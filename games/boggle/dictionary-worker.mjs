// Module workers do not inherit the document's import map. Propagate the release query.
const assetQuery = new URL(import.meta.url).search;
const ready = Promise.all([import('./dictionary.mjs' + assetQuery), import('./board.mjs' + assetQuery)]);
let loaded = null, loadedLanguage = null;
self.onmessage = async ({ data }) => {
  const { id, settings } = data;
  try {
    // Install this listener synchronously: messages can arrive while imports are pending.
    const [{ readDictionary }, { prepareBoard }] = await ready;
    if (!['pl', 'en'].includes(settings?.language)) throw new Error('Unknown dictionary language.');
    if (loadedLanguage !== settings.language) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 60000);
      try {
        const response = await fetch(new URL(`./data/${settings.language}.bin.gz?v=boggle1`, import.meta.url), { signal: controller.signal });
        if (!response.ok) throw new Error('Dictionary download failed.');
        if (typeof DecompressionStream !== 'function') throw new Error('Please update your browser to load dictionaries.');
        const buffer = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        loaded = readDictionary(buffer); loadedLanguage = settings.language;
      } finally { clearTimeout(timer); }
    }
    self.postMessage({ id, result: prepareBoard(settings, loaded) });
  } catch (error) { self.postMessage({ id, error: error.name === 'AbortError' ? 'Dictionary download timed out. Please try again.' : error.message }); }
};
