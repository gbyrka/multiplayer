import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readDictionary, findPath, validPath, solveBoard, normalizeWord } from '../games/boggle/dictionary.mjs';
import { prepareBoard } from '../games/boggle/board.mjs';
import { createBoggleGame, DEFAULT_SETTINGS, pointsFor } from '../games/boggle/game-core.mjs';
import { SoloSession } from '../games/boggle/solo-session.mjs';
import { isClientMessage, isMessage, message } from '../shared/protocol.mjs';
import { GAMES, COLLECTION_GAMES } from '../games/registry.mjs';

const root = new URL('../games/boggle/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('data/manifest.json', root)));
const dictionaries = {};
for (const language of ['pl', 'en']) {
  const compressed = readFileSync(new URL(`data/${language}.bin.gz`, root)), bytes = gunzipSync(compressed);
  dictionaries[language] = readDictionary(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  test(`${language}: packaged graph matches its hash and exact source word count`, () => {
    assert.equal(createHash('sha256').update(compressed).digest('hex'), manifest.languages[language].sha256);
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = header.getUint32(8, true);
    const offsets = new Uint32Array(bytes.buffer, bytes.byteOffset + 16, count + 1), edges = new Uint32Array(bytes.buffer, bytes.byteOffset + 16 + (count + 1) * 4);
    const words = new Float64Array(count);
    for (let node = 0; node < count; node++) {
      words[node] = offsets[node] & 1;
      for (let i = offsets[node] >>> 1; i < offsets[node + 1] >>> 1; i++) words[node] += words[edges[i] >>> 6];
    }
    assert.equal(words[header.getUint32(4, true)], manifest.languages[language].words);
  });
}

test('actual Polish dictionary recognizes inflections, long words and accents; excludes proper-only names and misspellings', () => {
  for (const word of ['kot', 'kota', 'kotami', 'psa', 'psami', 'ludzie', 'ludzi', 'dzieci', 'dziećmi', 'idę', 'szedłem', 'zrobiłbym', 'poszłybyśmy', 'czytalibyście', 'najniebezpieczniejszymi', 'źdźbło', 'gęślą', 'jaźń', 'polska', 'warszawa']) assert.ok(dictionaries.pl.has(word), word);
  for (const word of ['kotuw', 'poszłem', 'kraków', 'PKP', 'np', 'biało-czerwony', 'śmy']) assert.equal(dictionaries.pl.has(word), false, word);
  assert.equal(normalizeWord('  GE\u0328S\u0301LA\u0328  '), 'gęślą');
});
test('actual English dictionary includes UK/US, irregular and very long words, and filters names, abbreviations and fragments', () => {
  for (const word of ['played', 'playing', 'went', 'gone', 'children', 'mice', 'better', 'best', 'colour', 'color', 'centre', 'center', 'organise', 'organize', 'may', 'am', 'cant', 'antidisestablishmentarianism', 'pneumonoultramicroscopicsilicovolcanoconiosis']) assert.ok(dictionaries.en.has(word), word);
  for (const word of ['recieve', 'goed', 'childs', 'london', 'NASA', 'aka', 'etc', 'mph', "can't", 'mother-in-law']) assert.equal(dictionaries.en.has(word), false, word);
});

export const fixtureBoard = [...'catsreaddogslion'];
export function staged(settings = DEFAULT_SETTINGS) {
  return { settings: { ...settings }, dictionaryVersion: 'boggle1', board: [...fixtureBoard], solutions: [...solveBoard(fixtureBoard, 4, dictionaries.en, settings.minLength)] };
}
function table(settings = {}) {
  let time = 0;
  const game = createBoggleGame({ now: () => time }), core = game.adapter;
  let state = core.addPlayer(core.createLobby('host', 'Host'), 'guest', 'Guest');
  if (Object.keys(settings).length) state = core.applyAction(state, 'host', 'BOGGLE_ACTION', { action: 'SETTINGS', ...DEFAULT_SETTINGS, ...settings });
  state = core.applyAction(state, 'guest', 'SET_READY', { ready: true });
  const act = (id, type, payload) => state = core.applyAction(state, id, type, payload);
  const tick = timestamp => { time = timestamp; const transition = core.automaticTransition(state); if (transition?.delay === 0) state = transition.apply(state); };
  const start = () => { game.stageRound(staged(state.settings)); act('host', 'START_GAME'); tick(4000); };
  return { game, core, get state() { return state; }, act, tick, start };
}
test('solver enforces adjacency, diagonal paths, tile uniqueness, all sizes and minimum lengths', () => {
  const solutions = solveBoard(fixtureBoard, 4, dictionaries.en);
  for (const word of ['cat', 'cats', 'read', 'dog', 'dogs', 'lion', 'tad']) assert.ok(solutions.has(word), word);
  for (const [word, path] of solutions) assert.ok(validPath(fixtureBoard, 4, path, word), word);
  assert.equal(findPath(fixtureBoard, 4, 'catac'), null);
  assert.equal(validPath(fixtureBoard, 4, [0, 1, 0], 'cac'), false);
  assert.equal(validPath(fixtureBoard, 4, [0, 15], 'cn'), false);
  assert.ok([...solveBoard(fixtureBoard, 4, dictionaries.en, 5).keys()].every(word => word.length >= 5));
  assert.throws(() => solveBoard(['a'], 4, dictionaries.en), /Invalid/);
  assert.throws(() => readDictionary(new ArrayBuffer(24)), /Invalid/);
});
test('boards are fully solved before play, including 6×6, with genuine longest paths', () => {
  for (const language of ['pl', 'en']) for (const size of [4, 5, 6]) for (const minLength of [3, 4, 5]) {
    const settings = { ...DEFAULT_SETTINGS, language, size, minLength }, prepared = prepareBoard(settings, dictionaries[language]);
    assert.ok(prepared.solutions.length);
    for (const [word, path] of prepared.solutions) {
      assert.ok(word.length >= minLength && dictionaries[language].has(word)); assert.ok(validPath(prepared.board, size, path, word));
    }
  }
});
test('lobby permissions, capacity, readiness and settings stay authoritative', () => {
  const t = table(), { core } = t;
  assert.throws(() => t.act('guest', 'START_GAME'), /host/);
  assert.throws(() => t.act('guest', 'BOGGLE_ACTION', { action: 'SETTINGS', ...DEFAULT_SETTINGS }), /host/);
  t.act('host', 'BOGGLE_ACTION', { action: 'SETTINGS', ...DEFAULT_SETTINGS, minLength: 5 });
  assert.equal(t.state.players[1].ready, false); assert.equal(core.buildViewForPlayer(t.state, 'host').canStart, false);
  assert.throws(() => t.act('host', 'START_GAME'), /ready/);
  let full = t.state;
  for (let i = 2; i < 6; i++) full = core.addPlayer(full, String(i), 'Friend');
  assert.throws(() => core.addPlayer(full, 'extra', 'Extra'), /full/);
});
test('countdown hides the board and solutions; words remain private until the deadline', () => {
  const t = table(); t.game.stageRound(staged()); t.act('host', 'START_GAME');
  const countdown = t.core.buildViewForPlayer(t.state, 'guest'); assert.deepEqual(countdown.board, []); assert.equal(countdown.remainingMs, 4000);
  assert.throws(() => t.act('host', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 }), /not accepting/);
  t.tick(4000); t.act('host', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 });
  const guest = t.core.buildViewForPlayer(t.state, 'guest'), host = t.core.buildViewForPlayer(t.state, 'host');
  assert.deepEqual(guest.myWords, []); assert.deepEqual(host.myWords, ['cats']);
  assert.equal(guest.result, null); assert.equal(guest.players[0].total, 0);
  assert.doesNotMatch(JSON.stringify(guest), /solutions|submissions|cats|longest/);
  assert.throws(() => t.act('host', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 }), /already/);
});
test('host clock rejects late, wrong-round, short, nonexistent and non-adjacent words', () => {
  const t = table({ minLength: 4 }); t.start();
  for (const [word, round, pattern] of [['cat', 1, /at least 4/], ['zzzz', 1, /dictionary/], ['lion', 2, /not accepting/], ['catac', 1, /dictionary/]]) {
    assert.throws(() => t.act('guest', 'BOGGLE_ACTION', { action: 'SUBMIT', word, round }), pattern);
  }
  t.tick(184000); assert.equal(t.state.phase, 'round_result');
  assert.throws(() => t.act('host', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'lion', round: 1 }), /not accepting/);
});
test('shared words cancel, distinct inflections score separately, and longest words have correct paths and finders', () => {
  const t = table({ rounds: 1 }); t.start();
  for (const [id, word] of [['host', 'cat'], ['host', 'cats'], ['guest', 'cats'], ['guest', 'lion']]) t.act(id, 'BOGGLE_ACTION', { action: 'SUBMIT', word, round: 1 });
  t.tick(184000); const result = t.state.result;
  assert.equal(t.state.phase, 'game_result');
  assert.equal(result.scores[0].words.find(entry => entry.word === 'cats').points, 0);
  assert.equal(result.scores[0].score, 1); assert.equal(result.scores[1].score, 1); assert.deepEqual(t.state.winnerIds, ['host', 'guest']);
  const longest = Math.max(...[...t.state.solutions.keys()].map(word => word.length));
  assert.ok(result.longest.length <= 5 && result.longest.every(entry => entry.word.length === longest && validPath(t.state.board, 4, entry.path, entry.word)));
  for (const entry of result.longest) assert.deepEqual(entry.foundBy, result.scores.filter(p => p.words.some(w => w.word === entry.word)).map(p => p.id));
  assert.deepEqual([2, 3, 4, 5, 6, 7, 8, 30].map(pointsFor), [0, 1, 1, 2, 3, 5, 11, 11]);
  assert.throws(() => t.act('host', 'PLAY_AGAIN'), /breath/); t.tick(187000); t.act('host', 'PLAY_AGAIN');
  assert.equal(t.state.phase, 'lobby'); assert.equal(t.state.players[1].ready, false); assert.ok(t.state.players.every(p => p.total === 0));
});
test('later rounds reset submissions, preserve totals and reject old-round intents', () => {
  const t = table(); t.start(); t.act('host', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 }); t.tick(184000);
  assert.equal(t.state.players[0].total, 1); assert.throws(() => t.act('host', 'NEXT_HAND'), /countdown/);
  t.tick(187000); t.game.stageRound(staged()); t.act('host', 'NEXT_HAND'); t.tick(191000);
  assert.equal(t.state.round, 2); assert.equal(t.state.players[0].total, 1); assert.deepEqual(t.state.submissions.host, []);
  assert.throws(() => t.act('guest', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 }), /not accepting/);
  t.act('guest', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 2 });
});
test('the round serial survives rematches so delayed old first-round words cannot enter a new game', () => {
  const t = table({ rounds: 1 }); t.start(); t.tick(184000); t.tick(187000); t.act('host', 'PLAY_AGAIN');
  t.act('guest', 'SET_READY', { ready: true }); t.game.stageRound(staged(t.state.settings)); t.act('host', 'START_GAME'); t.tick(191000);
  assert.equal(t.state.round, 1); assert.equal(t.state.roundSerial, 2);
  assert.throws(() => t.act('guest', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 }), /not accepting/);
  t.act('guest', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 2 });
});
test('disconnects stop play and returning to the lobby drops disconnected players', () => {
  const t = table(); t.start(); const state = t.core.removePlayer(t.state, 'guest');
  assert.equal(state.phase, 'disconnected'); assert.equal(t.core.automaticTransition(state), null);
  const lobby = t.core.applyAction(state, 'host', 'RETURN_TO_LOBBY'); assert.equal(lobby.players.length, 1); assert.equal(lobby.round, 0);
});
test('solo practice starts with one player, stays solo on rematch and refuses extra players', () => {
  let time = 0;
  const game = createBoggleGame({ solo: true, now: () => time }), core = game.adapter;
  let state = core.createLobby('host', 'Practice');
  assert.equal(core.buildViewForPlayer(state, 'host').canStart, true);
  assert.equal(core.buildViewForPlayer(state, 'host').solo, true);
  assert.throws(() => core.addPlayer(state, 'guest', 'Guest'), /solo/);
  state = core.applyAction(state, 'host', 'BOGGLE_ACTION', { action: 'SETTINGS', ...DEFAULT_SETTINGS, rounds: 1 });
  game.stageRound(staged(state.settings)); state = core.applyAction(state, 'host', 'START_GAME');
  time = 4000; state = core.automaticTransition(state).apply(state);
  state = core.applyAction(state, 'host', 'BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 });
  time = state.endsAt; state = core.automaticTransition(state).apply(state);
  assert.equal(state.phase, 'game_result'); assert.equal(state.players[0].total, 1);
  assert.equal(state.result.scores[0].words[0].shared, false); assert.ok(state.result.longest.length);
  time += 3000; state = core.applyAction(state, 'host', 'PLAY_AGAIN');
  assert.equal(state.solo, true); assert.equal(state.players[0].total, 0); assert.equal(core.buildViewForPlayer(state, 'host').canStart, true);
  const multiplayer = createBoggleGame().adapter;
  assert.equal(multiplayer.buildViewForPlayer(multiplayer.createLobby('host', 'Host'), 'host').canStart, false);
});
test('local solo session uses real rules, ends the round automatically and reports invalid words', async t => {
  let time = 0, resolvePlaying, resolveFinished;
  const playing = new Promise(resolve => { resolvePlaying = resolve; }), finished = new Promise(resolve => { resolveFinished = resolve; });
  const base = createBoggleGame({ solo: true, now: () => time }), core = base.adapter, errors = [];
  const game = { ...base, adapter: { ...core, applyAction(...args) {
    const state = core.applyAction(...args); return args[2] === 'START_GAME' ? { ...state, startsAt: 0, endsAt: 1000 } : state;
  }, automaticTransition(state) {
    const transition = core.automaticTransition(state);
    return state.phase === 'playing' ? { delay: 10, apply: snapshot => { time = snapshot.endsAt; return core.automaticTransition(snapshot).apply(snapshot); } } : transition;
  } } };
  const session = new SoloSession({ game, onView: view => { if (view.phase === 'playing') resolvePlaying(); if (view.phase === 'round_result') resolveFinished(); }, onError: error => errors.push(error) });
  t.after(() => session.close()); await session.create('Practice');
  assert.equal(session.isSolo, true); assert.equal(session.network, undefined); assert.equal(session.view.canStart, true);
  game.stageRound(staged()); session.act('START_GAME'); await playing;
  session.act('BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 });
  session.act('BOGGLE_ACTION', { action: 'SUBMIT', word: 'cats', round: 1 }); assert.match(errors.at(-1), /already/);
  session.act('BOGGLE_ACTION', { action: 'SUBMIT', word: 'zzzz', round: 1 }); assert.match(errors.at(-1), /dictionary/);
  await finished; assert.equal(session.view.players[0].total, 1); assert.deepEqual(session.view.myWords, ['cats']);
  time += 3000; game.stageRound(staged()); session.act('NEXT_HAND');
  assert.equal(session.view.round, 2); session.close(); const revision = session.revision;
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(session.revision, revision);
});
test('protocol rejects forged identity, illegal settings and oversized word payloads', () => {
  const payload = { action: 'SUBMIT', word: 'kotami', round: 1 };
  assert.ok(isClientMessage(message('BOGGLE_ACTION', payload)));
  for (const extra of [{ playerId: 'host' }, { points: 100 }, { word: 'a'.repeat(37) }, { round: 0 }, { word: '<b>kot</b>' }]) assert.equal(isClientMessage(message('BOGGLE_ACTION', { ...payload, ...extra })), false);
  for (const minLength of [3, 4, 5]) assert.ok(isClientMessage(message('BOGGLE_ACTION', { action: 'SETTINGS', ...DEFAULT_SETTINGS, minLength })));
  assert.equal(isClientMessage(message('BOGGLE_ACTION', { action: 'SETTINGS', ...DEFAULT_SETTINGS, minLength: 2 })), false);
});
test('six-player maximum result stays inside the configured wire limit', () => {
  const game = createBoggleGame({ now: () => 200000 }), core = game.adapter;
  let state = core.createLobby('host', 'Host');
  for (let i = 1; i < 6; i++) state = core.addPlayer(state, String(i), 'Friend');
  const solutions = new Map(Array.from({ length: 1500 }, (_, i) => ['a'.repeat(32) + String(i).padStart(4, '0'), []]));
  state = { ...state, phase: 'playing', round: 1, board: fixtureBoard, solutions, endsAt: 184000,
    submissions: Object.fromEntries(state.players.map((p, index) => [p.id, [...solutions.keys()].slice(index * 250, (index + 1) * 250)])) };
  state = core.automaticTransition(state).apply(state);
  const view = core.buildViewForPlayer(state, 'host');
  assert.ok(isMessage(message('STATE_UPDATE', { view }), game.maxStateMessageLength));
});
test('game is unlisted and noindex; all production modules are in the release manifest', () => {
  assert.equal([...GAMES, ...COLLECTION_GAMES].some(game => game.id === 'boggle'), false);
  const html = readFileSync(new URL('index.html', root), 'utf8'); assert.match(html, /name="robots" content="noindex, nofollow"/);
  const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url)));
  for (const name of ['action-schema', 'app', 'board', 'dictionary', 'dictionary-worker', 'game-core', 'ui']) assert.ok(config.modules.includes(`./games/boggle/${name}.mjs`));
});
