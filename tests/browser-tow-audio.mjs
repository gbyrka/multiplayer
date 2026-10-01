/** Render the production sound graph with native OfflineAudioContext. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = process.env.PLAYWRIGHT_MODULE ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE)) : await import('playwright');
const root = new URL('../', import.meta.url);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const relative = decodeURIComponent(url.pathname).slice(1) + (url.pathname.endsWith('/') ? 'index.html' : '');
  if (relative.includes('..')) { response.writeHead(404).end(); return; }
  try {
    const content = await readFile(new URL(relative, root));
    const type = relative.endsWith('.mjs') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css' : relative.endsWith('.json') ? 'application/json' : relative.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    response.writeHead(200, { 'Content-Type': type }); response.end(content);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/games/tow/`); await page.locator('#home').waitFor();
  const result = await page.evaluate(async () => {
    const { RaceSound } = await import('./sound.mjs');
    const { makeRig, INPUT } = await import('./physics.mjs'); const { makeTrack } = await import('./track.mjs');
    const track = makeTrack(34);
    async function render({ other = 2400, speed = 0, horn = false, skid = false } = {}) {
      const offline = new OfflineAudioContext(2, 21600, 24000);
      // Only replace the context constructor: all production buffers, filters,
      // envelopes, panners and mixing remain unchanged and run natively.
      const context = new Proxy(offline, { get(target, key) {
        if (key === 'state') return 'running';
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      const NativeAudio = window.AudioContext; let sound;
      try { window.AudioContext = function () { return context; }; sound = new RaceSound(); sound.enabled = true; sound.unlock(); }
      finally { window.AudioContext = NativeAudio; }
      const rigs = [makeRig(track, 0), makeRig(track, 1)];
      rigs.forEach((rig, i) => {
        Object.assign(rig.car, { x: i ? other : 0, y: 0, a: 0, vx: 0, vy: i ? 0 : -speed, speed: i ? 0 : speed, omega: !i && skid ? 2 : 0 });
        Object.assign(rig.trailer, { x: rig.car.x, y: 94, a: 0, vx: 0, vy: rig.car.vy, omega: rig.car.omega });
      });
      if (horn) sound.horn(true);
      sound.update(rigs, 0, { phase: 'racing', masks: [speed ? INPUT.UP : 0, 0], horns: [false, false] }, speed ? INPUT.UP : 0, .4);
      const buffer = await offline.startRendering(), left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      const first = 4800, last = 18000;
      const rms = values => Math.sqrt(values.slice(first, last).reduce((sum, value) => sum + value * value, 0) / (last - first));
      const power = frequency => {
        let re = 0, im = 0;
        for (let i = first; i < last; i++) { const phase = Math.PI * 2 * frequency * i / 24000, value = (left[i] + right[i]) / 2; re += value * Math.cos(phase); im += value * Math.sin(phase); }
        return (re * re + im * im) / (last - first) ** 2;
      };
      let peak = 0, finite = true;
      for (const values of [left, right]) for (const value of values) { peak = Math.max(peak, Math.abs(value)); finite &&= Number.isFinite(value); }
      let strongest = 0, frequency = 0;
      for (let f = 20; f <= 650; f += 5) { const value = power(f); if (value > strongest) { strongest = value; frequency = f; } }
      const highPower = [1250, 1370, 1450, 1580, 1700].reduce((sum, f) => sum + power(f), 0);
      sound.stop();
      return { left: rms(left), right: rms(right), frequency, peak, finite, horn350: power(350), horn440: power(440), highPower };
    }
    return { idle: await render(), fast: await render({ speed: 300 }), nearRight: await render({ other: 120 }),
      nearLeft: await render({ other: -120 }), horn: await render({ horn: true }), skid: await render({ speed: 300, skid: true }) };
  });
  for (const sound of Object.values(result)) { assert.ok(sound.finite); assert.ok(sound.peak < .99); assert.ok(sound.left > .001 && sound.right > .001); }
  assert.ok(Math.abs(result.idle.left - result.idle.right) < .00001);
  assert.ok(result.nearRight.right > result.nearRight.left * 1.2); assert.ok(result.nearLeft.left > result.nearLeft.right * 1.2);
  assert.ok(result.nearRight.right > result.idle.right * 1.3, 'nearby opponent is louder than distant opponent');
  assert.ok(result.fast.frequency > result.idle.frequency * 2, 'engine pitch follows speed');
  assert.ok(result.horn.horn350 > result.idle.horn350 * 10 && result.horn.horn440 > result.idle.horn440 * 10, 'both horn tones reach the output');
  assert.ok(result.skid.highPower > result.fast.highPower * 2, 'hard turns produce an audible tyre squeal');
  assert.deepEqual(errors, []);
  console.log('PASS Actual rendered audio: distance, left/right stereo, engine pitch, dual-tone horn, tyre squeal, finite samples and no clipping.');
} finally { await browser.close(); server.close(); }
