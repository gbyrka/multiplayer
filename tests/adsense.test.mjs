import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const projects = ['games', 'multiplayer', 'dock', 'park', 'hamster', 'sokoban'];
const excluded = new Set(['.git', 'tests', 'test-results', 'node_modules', 'vendor']);
const voidTags = new Set(['meta', 'link', 'img', 'input', 'source', 'br', 'hr', 'area', 'base', 'wbr']);
async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = directory + entry.name;
    if (entry.isDirectory()) files.push(...await htmlFiles(path + '/'));
    else if (entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}
function parse(html) {
  const clean = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [], nodes = [], ids = new Set();
  for (const match of clean.matchAll(/<(\/?)([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const [, closing, tagName, raw] = match, tag = tagName.toLowerCase();
    if (closing) { const index = stack.findLastIndex(node => node.tag === tag); if (index >= 0) stack.length = index; continue; }
    const attrs = Object.fromEntries([...raw.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(m => [m[1], m[2] ?? m[3] ?? m[4] ?? '']));
    const node = { tag, attrs, parents: [...stack] }; nodes.push(node); if (attrs.id) ids.add(attrs.id);
    if (!voidTags.has(tag) && !raw.endsWith('/')) stack.push(node);
  }
  return { nodes, ids };
}
const files = ['gbyrka.github.io/index.html', ...(await Promise.all(projects.map(project => htmlFiles(project + '/')))).flat()];
const documents = new Map(await Promise.all(files.map(async file => [file, parse(await readFile(new URL(file, root), 'utf8'))])));

test('all six independent deployments have identical ad policy code and clear two-sided spacing', async () => {
  for (const file of ['monetization.js', 'ads.css']) {
    const expected = await readFile(new URL('games/' + file, root), 'utf8');
    for (const project of projects) assert.equal(await readFile(new URL(project + '/' + file, root), 'utf8'), expected, project + '/' + file);
  }
  const css = await readFile(new URL('games/ads.css', root), 'utf8');
  assert.match(css, /margin: 180px auto;/); assert.doesNotMatch(css, /margin-top:\s*24px/);
});
test('no game places a manual ad inside navigation, private chat or an About/rules dialog', () => {
  let slots = 0;
  for (const [file, document] of documents) {
    for (const node of document.nodes.filter(node => node.tag === 'ins' && node.attrs.class?.split(/\s+/).includes('adsbygoogle'))) {
      slots++;
      assert.ok(node.parents.some(p => p.attrs.class?.split(/\s+/).includes('ad-placement')), file);
      for (const parent of node.parents) {
        assert.ok(!['dialog', 'nav', 'button', 'a'].includes(parent.tag), `${file}: ad in ${parent.tag}`);
        assert.ok(!['dialog', 'navigation', 'log'].includes(parent.attrs.role), `${file}: ad in ${parent.attrs.role}`);
        assert.ok(!parent.attrs.class?.includes('room-chat'), `${file}: ad in chat`);
      }
    }
  }
  assert.equal(slots, 10, 'Keep only the ten ordinary, in-document placements.');
  for (const game of ['chess', 'checkers', 'boggle']) {
    assert.equal(documents.get(`multiplayer/games/${game}/index.html`).nodes.filter(n => n.tag === 'ins' && n.attrs.class === 'adsbygoogle').length, 0);
  }
});
test('every local navigation link and fragment resolves, including root, invitations and privacy links', async () => {
  for (const [file, document] of documents) for (const node of document.nodes.filter(node => node.tag === 'a' && node.attrs.href)) {
    const base = file.startsWith('gbyrka.github.io/') ? 'https://mod-it.games/' : 'https://mod-it.games/' + file;
    const url = new URL(node.attrs.href.replaceAll('&amp;', '&'), base);
    if (url.origin !== 'https://mod-it.games') continue;
    let target = decodeURIComponent(url.pathname).slice(1);
    if (!target || target === 'index.html') target = 'gbyrka.github.io/index.html';
    else if (target.endsWith('/')) target += 'index.html';
    assert.ok((await stat(new URL(target, root))).isFile(), `${file}: ${node.attrs.href}`);
    if (url.hash && documents.has(target)) assert.ok(documents.get(target).ids.has(decodeURIComponent(url.hash.slice(1))), `${file}: missing target ${node.attrs.href}`);
  }
});
test('the root has real navigable content without JavaScript; catalog categories are populated', async () => {
  const home = await readFile(new URL('gbyrka.github.io/index.html', root), 'utf8');
  assert.match(home, /<main id="main"/); assert.match(home, /Play with friends/);
  assert.doesNotMatch(home, /http-equiv="refresh"|location\.replace\(`https:\/\/mod-it\.games\/games\//);
  assert.doesNotMatch(home, /adsbygoogle|googletagmanager/);
  const catalog = await readFile(new URL('games/index.html', root), 'utf8');
  assert.doesNotMatch(catalog, /Coming soon|href="#mobile"|href="#cross-platform"/);
  const collection = await readFile(new URL('multiplayer/index.html', root), 'utf8');
  assert.match(collection, /aria-label="Multiplayer games"/);
});
