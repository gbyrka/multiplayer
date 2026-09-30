import test from 'node:test';
import assert from 'node:assert/strict';
import { getViewEffects } from '../shared/effects.mjs';
import { createSoundBuffer } from '../shared/sound.mjs';

const view = (changes = {}) => ({
  revision: 2, handNumber: 1, trickNumber: 1, phase: 'playing', trick: [],
  me: { id: 'me' }, players: [{ id: 'me', name: 'Host', totalScore: 10 }, { id: 'guest', name: 'Anna', totalScore: 9 }], ...changes,
});
const play = (playerId, id) => ({ playerId, card: { id } });

test('only newly accepted played cards cause sounds, with a distinct own-card effect', () => {
  const previous = view({ trick: [play('guest', '2C')] });
  const next = view({ revision: 3, phase: 'trick_result', trick: [play('guest', '2C'), play('me', 'AC')] });
  assert.deepEqual(getViewEffects(previous, next), [{ type: 'card', own: true }]);
  assert.deepEqual(getViewEffects(view(), view({ revision: 3, trick: [play('guest', '2C')] })), [{ type: 'card', own: false }]);
  assert.deepEqual(getViewEffects(next, next), []);
  assert.deepEqual(getViewEffects(next, previous), []);
  assert.deepEqual(getViewEffects(null, next), []);
});

test('collecting a trick, opening a new deal and rerendering never replay sounds', () => {
  const previous = view({ phase: 'trick_result', trick: [play('guest', '2C'), play('me', 'AC')] });
  assert.deepEqual(getViewEffects(previous, view({ revision: 3, trickNumber: 2 })), []);
  assert.deepEqual(getViewEffects(previous, view({ revision: 3, handNumber: 2, phase: 'bidding' })), []);
  assert.deepEqual(getViewEffects(previous, { ...previous, revision: 3 }), []);
});

test('a final victory triggers once, celebrates ties and identifies whether this player won', () => {
  const previous = view({ phase: 'trick_result' });
  const next = view({ revision: 3, phase: 'game_result' });
  assert.deepEqual(getViewEffects(previous, next), [{ type: 'victory', winners: ['Host'], own: true }]);
  assert.deepEqual(getViewEffects(next, { ...next, revision: 4 }), []);
  assert.deepEqual(getViewEffects(previous, { ...next, me: { id: 'guest' } }), []);
  const tie = { ...next, players: next.players.map(player => ({ ...player, totalScore: 10 })), me: { id: 'guest' } };
  assert.deepEqual(getViewEffects(previous, tie), [{ type: 'victory', winners: ['Host', 'Anna'], own: true }]);
});

test('synthesized card and triumph waveforms are finite, audible, bounded and smoothly fade to silence', () => {
  const context = {
    sampleRate: 24000,
    createBuffer(channels, length, sampleRate) {
      const data = new Float32Array(length);
      return { numberOfChannels: channels, duration: length / sampleRate, getChannelData: () => data };
    },
  };
  for (const [kind, duration] of [['card', .19], ['victory', 2.35]]) {
    const buffer = createSoundBuffer(context, kind);
    const samples = buffer.getChannelData(0);
    assert.equal(buffer.duration, duration);
    assert.equal(samples[0], 0);
    assert.ok(samples.every(Number.isFinite));
    assert.ok(Math.max(...samples.map(Math.abs)) < .6);
    assert.ok(samples.reduce((sum, value) => sum + value * value, 0) > .05);
    assert.ok(Math.abs(samples.at(-1)) < .001);
  }
});
