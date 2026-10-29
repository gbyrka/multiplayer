import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { driverProgress } from '../games/tow-drivers-seat/progress.mjs';
import { createRace, rankRace } from '../games/tow/race.mjs';
import { COLLECTION_GAMES } from '../games/registry.mjs';

test('cockpit progress follows host positions and resets, reserving 100% for a complete trailer finish', () => {
  const state = createRace(1234, 'progress', 4), { track } = state;
  state.progress = [track.start - 200, track.start + (track.finish - track.start) * .5, track.finish + 40, track.start];
  assert.equal(driverProgress(state, track, 0).fraction, 0);
  assert.ok(Math.abs(driverProgress(state, track, 1).fraction - .5) < 1e-10);
  assert.equal(driverProgress(state, track, 2).fraction, .99);
  state.finished[3] = 80;
  assert.deepEqual(driverProgress(state, track, 3), { slot:3, finished:true, fraction:1 });
  assert.equal(rankRace(state)[0], 3);
  state.progress[1] = track.start;
  assert.equal(driverProgress(state, track, 1).fraction, 0);
});

test('Driver’s Seat is unlisted with noindex metadata, and its complete module graph is versioned', async () => {
  const root = new URL('../', import.meta.url);
  assert.ok(!COLLECTION_GAMES.some(game => game.href?.includes('tow-drivers-seat')));
  const [entry, catalog, collection] = await Promise.all(['games/tow-drivers-seat/index.html', '../games/index.html', 'index.html'].map(path => readFile(new URL(path, root), 'utf8')));
  assert.match(entry, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(entry, /canonical.*https:\/\/mod-it.games\/multiplayer\/games\/tow-drivers-seat\//);
  assert.doesNotMatch(catalog, /tow-drivers-seat/); assert.doesNotMatch(collection, /tow-drivers-seat/);
  const files = (await readdir(root, { recursive:true })).filter(path => path.endsWith('.mjs') && !path.startsWith('tests/') && !path.startsWith('node_modules/')).map(path => `./${path}`).sort();
  const config = JSON.parse(await readFile(new URL('config.json', root), 'utf8'));
  assert.deepEqual([...config.modules].sort(), files);
});
