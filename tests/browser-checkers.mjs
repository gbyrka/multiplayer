/** Local Chromium + actual PeerJS/WebRTC. Google scripts are stubbed; no real telemetry/ads. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const { PeerServer } = await import(process.env.PEER_SERVER_MODULE ? pathToFileURL(process.env.PEER_SERVER_MODULE).href : 'peer');
const client = await readFile(process.env.PEERJS_SCRIPT ?? join(dirname(require.resolve('peerjs')), 'peerjs.min.js'), 'utf8');
const root = new URL('../../', import.meta.url), output = process.env.SCREENSHOT_DIR ?? 'test-results/chess'; await mkdir(output, { recursive: true });
let signal; await new Promise(resolve => PeerServer({ host: '127.0.0.1', port: 0, path: '/signal' }, s => { signal = s; resolve(); }));
const server = createServer(async (request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (!/^\/(games|multiplayer)\//.test(path) || path.includes('..')) return response.writeHead(404).end();
  const file = path.slice(1) + (path.endsWith('/') ? 'index.html' : '');
  try { const data = await readFile(new URL(file, root)); response.writeHead(200, { 'Content-Type': { mjs:'text/javascript', js:'text/javascript', css:'text/css', json:'application/json', svg:'image/svg+xml', png:'image/png', webp:'image/webp', jpg:'image/jpeg' }[file.split('.').at(-1)] ?? 'text/html' }).end(data); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/multiplayer/games/checkers/';
const browser = await chromium.launch({ headless:true, args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows'] });
const contexts=[],errors=[]; let failed=false;
async function page(touch=false) {
  const context = await browser.newContext({ viewport:{width:1440,height:1080}, reducedMotion:'reduce', hasTouch:touch }); contexts.push(context);
  await context.route('**/peerjs@1.5.5/dist/peerjs.min.js', r => r.fulfill({ contentType:'text/javascript', body:client + `\nconst OriginalPeer = window.Peer; window.Peer = class extends OriginalPeer { constructor(id, options) { super(id, { ...options, host:'127.0.0.1', port:${signal.address().port}, path:'/signal', secure:false, config:{iceServers:[]} }); } };` }));
  await context.route('**/pagead2.googlesyndication.com/**', r => r.fulfill({contentType:'text/javascript',body:''}));
  await context.route('**/www.googletagmanager.com/**', r => r.fulfill({contentType:'text/javascript',body:''}));
  const p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));return p;
}
async function hooks(p) {
  await p.evaluate(async()=>{
    const {GameRoom}=await import('../../shared/room.mjs'), core=await import('./game-core.mjs');
    const original=GameRoom.prototype.create, join=GameRoom.prototype.join;
    GameRoom.prototype.create=function(...args){
      window.__checkersRoom=this;
      this.game={...this.game,adapter:{...this.game.adapter,applyAction(...args){
        let next;
        if(window.__fixture){
          next=structuredClone(args[0]);Object.assign(next,{phase:'playing',board:window.__fixture.board,turn:'w',chain:null,history:[],stepSerial:0,quietKings:0,positions:{},drawOffer:null,result:null},window.__fixture);
          next.revision++;core.adjudicate(next);window.__fixture=null;
        }else next=core.applyAction(...args);
        window.__state=next;return next;
      }}};
      return original.apply(this,args);
    };
    GameRoom.prototype.join=function(...args){window.__checkersRoom=this;return join.apply(this,args);};
    window.__setFixture=fixture=>{window.__fixture=fixture;window.__checkersRoom.act('CHECKERS_ACTION',{action:'OFFER_DRAW'});};
  });
}
const clickSquare=async(p,s)=>{const node=p.locator(`[data-square="${s}"]`);if(await p.evaluate(()=>navigator.maxTouchPoints>0))await node.tap();else await node.click();};
const play=async(p,a,b)=>{await clickSquare(p,a);await clickSquare(p,b);};
async function noOverflow(p,width,height=1050){
  await p.setViewportSize({width,height});
  const dimensions=await p.evaluate(()=>({root:[document.documentElement.scrollWidth,document.documentElement.scrollHeight],body:[document.body.scrollWidth,document.body.scrollHeight],viewport:[innerWidth,innerHeight]}));
  assert.ok(dimensions.root[0]<=width+1&&dimensions.body[0]<=width+1&&dimensions.root[1]<=height+1&&dimensions.body[1]<=height+1,`Page must fit ${width}x${height}: ${JSON.stringify(dimensions)}`);
  const controls=await p.locator('.lobby-heading, .invite-card, .lobby-players, #settings-form, .lobby-start, .game .chess-board, #game-status, .game>.player-bar, .game-toolbar, .promotion-panel').evaluateAll(nodes=>nodes.filter(node=>node.getClientRects().length).map(node=>{const {x,y,width,height}=node.getBoundingClientRect();return {class:node.className,x,y,width,height};}));
  for(const box of controls)assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=width+1&&box.y+box.height<=height+1,`Important content must be visible at ${width}x${height}: ${JSON.stringify(box)}`);
}
async function fitScreens(p,phase){
  for(const [width,height] of [[1440,900],[1366,768],[1280,720],[1024,600],[768,1024],[390,844],[375,667],[320,568],[320,480],[667,375],[568,320]]){
    await noOverflow(p,width,height);
    if(width<=980||height<=600)assert.equal(await p.locator('#sidebar').isHidden(),true,'Resizing must keep the board visible, without opening the room drawer');
    if([[1366,768],[375,667],[568,320]].some(([w,h])=>w===width&&h===height))await p.screenshot({path:`${output}/${phase}-${width}x${height}.png`});
  }
  await p.setViewportSize({width:1440,height:900});
}
async function fixture(p,board,extra={}){await p.evaluate(({board,extra})=>window.__setFixture({board,...extra}),{board,extra});await p.waitForTimeout(50);}
const man=(square,color='w',king=false)=>({square,color,king});
try {
  const host=await page();await host.goto(base);await host.locator('.home').waitFor();await hooks(host);
  assert.equal(await host.locator('meta[name="robots"]').count(),0);
  await fitScreens(host,'home');await host.locator('#your-name').fill('Alex');await host.getByRole('button',{name:'CREATE A TABLE ↗',exact:true}).click();await host.locator('.lobby').waitFor();
  assert.equal(await host.locator('#use-clock, #clock-minutes').count(),0);
  await host.locator('select[name="hostColor"]').selectOption('b');await host.getByRole('button',{name:'SAVE SETTINGS'}).click();
  const invite=await host.locator('#invite-link').inputValue();assert.match(invite,/games\/checkers\/\?room=/);
  const guest=await page(true);await guest.goto(invite);await guest.locator('.home').waitFor();await hooks(guest);
  await guest.locator('#your-name').fill('Sam');await guest.getByRole('button',{name:'JOIN THE TABLE ↗',exact:true}).click();await guest.locator('.lobby').waitFor();assert.match(await guest.locator('.guest-settings').innerText(),/Host plays Black/);
  await guest.getByRole('button',{name:'I’M READY'}).click();await host.locator('[data-action="start"]:not(:disabled)').waitFor();await fitScreens(host,'lobby');
  await host.locator('[data-action="start"]').click();await guest.locator('.game').waitFor();
  assert.equal(await host.locator('.square').first().getAttribute('data-square'),'h1');assert.equal(await guest.locator('.square').first().getAttribute('data-square'),'a8');
  assert.equal(await guest.locator('.piece-w').count(),12);assert.equal(await guest.locator('.piece-b').count(),12);assert.equal(await guest.locator('.chess-clock').count(),0);
  assert.equal(await host.locator('.can-move').count(),0);assert.equal(await guest.locator('.can-move').count(),4);
  await clickSquare(guest,'c3');assert.deepEqual((await guest.locator('.legal-target').evaluateAll(n=>n.map(x=>x.dataset.square))).sort(),['b4','d4']);await guest.keyboard.press('Escape');
  await fitScreens(host,'black');await fitScreens(guest,'white');
  await play(guest,'c3','d4');await host.locator('[data-square="d4"] .piece-w').waitFor();
  await noOverflow(guest,375,667);await guest.getByRole('button',{name:'Open room chat',exact:true}).click();await guest.locator('#chat-input').fill('Good luck!');await guest.locator('.chat-send').click();await host.getByText('Good luck!',{exact:true}).waitFor();
  await guest.locator('#chat-input').fill('My draft stays.');await guest.keyboard.press('Escape');await noOverflow(guest,1440,900);await guest.locator('#chat-tab').click();assert.equal(await guest.locator('#chat-input').inputValue(),'My draft stays.');
  console.log('PASS two-player WebRTC, colors, opposite perspectives, no clock, legal moves, touch, chat and full-window layouts');

  await fixture(host,[man('a3'),man('h2'),man('b4','b'),man('d6','b'),man('g3','b')]);
  assert.equal(await guest.locator('#game-status h1').innerText(),'CAPTURE REQUIRED');assert.equal(await guest.locator('.can-move').count(),1);assert.equal(await guest.locator('[data-square="h2"]').isDisabled(),true);
  await play(guest,'a3','c5');await guest.getByRole('heading',{name:'CONTINUE CAPTURE',exact:true}).waitFor();
  assert.equal(await guest.locator('[data-square="c5"]').getAttribute('aria-pressed'),'true');assert.deepEqual(await guest.locator('.legal-target').evaluateAll(n=>n.map(x=>x.dataset.square)),['e7']);
  assert.equal(await guest.locator('[data-square="b4"].captured-square .piece').count(),1);assert.equal(await host.locator('.selected').count(),0);
  assert.equal(await guest.getByRole('button',{name:'Clear selection',exact:true}).isDisabled(),true);
  await fitScreens(guest,'forced-capture');await clickSquare(guest,'e7');await host.locator('[data-square="e7"] .piece-w').waitFor();
  assert.equal(await host.locator('[data-square="b4"] .piece').count(),0);assert.equal(await host.locator('[data-square="d6"] .piece').count(),0);
  await host.locator('#moves-tab').click();assert.match(await host.locator('.move-history').innerText(),/a3×c5×e7/);await host.locator('#chat-tab').click();
  console.log('PASS compulsory maximum capture, locked continuation, faded blockers, atomic completion and full-sequence history');

  await fixture(host,[man('c3','w',true),man('e5','b'),man('g5','b')]);await clickSquare(guest,'c3');assert.deepEqual(await guest.locator('.legal-target').evaluateAll(n=>n.map(x=>x.dataset.square)),['f6']);
  await clickSquare(guest,'f6');await guest.locator('[data-square="h4"].legal-target').waitFor();await clickSquare(guest,'h4');await guest.getByRole('heading',{name:'VICTORY',exact:true}).waitFor();assert.match(await guest.locator('#game-status').innerText(),/Sam wins with White/);
  await fixture(host,[man('a7'),man('h8','b')]);await play(guest,'a7','b8');await guest.locator('[data-square="b8"] .counter-crown').waitFor();
  await fixture(host,[man('b6'),man('c7','b'),man('e7','b'),man('h8','b')]);await play(guest,'b6','d8');await guest.locator('[data-square="f6"].legal-target').waitFor();assert.equal(await guest.locator('[data-square="d8"] .counter-crown').count(),0);await clickSquare(guest,'f6');await guest.locator('[data-square="f6"] .piece-w').waitFor();assert.equal(await guest.locator('[data-square="f6"] .counter-crown').count(),0);
  await fixture(host,[man('a1','b'),man('h8')],{turn:'b'});await host.getByRole('heading',{name:'VICTORY',exact:true}).waitFor();await fitScreens(host,'blocked-win');
  await host.locator('[data-action="play-again"]').click();await guest.locator('.lobby').waitFor();assert.equal(await guest.locator('[data-action="ready"]').innerText(),'I’M READY');assert.equal(await host.getByText('Good luck!',{exact:true}).count(),1);
  console.log('PASS flying king landing choices, promotion only after a completed turn, blocked-player loss and ready-checked rematches');

  const audit=await page();let ga=0;audit.on('request',r=>{if(r.url().includes('googletagmanager.com'))ga++;});await audit.goto(base);await audit.locator('.home').waitFor();assert.equal(ga,0);
  const analytics=audit.waitForRequest('**/www.googletagmanager.com/**');await audit.evaluate(()=>{window.googlefc.getGoogleConsentModeValues=()=>({analyticsStoragePurposeConsentStatus:1});window.googlefc.callbackQueue.find(c=>c.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY();});await analytics;assert.equal(ga,1);
  await audit.getByRole('button',{name:'About & sponsors',exact:true}).click();assert.equal(await audit.locator('#checkers-ad').isVisible(),true);await audit.getByRole('button',{name:'Close about',exact:true}).click();await noOverflow(audit,375,667);
  for(const path of ['/multiplayer/','/games/']){await audit.goto(origin+path);if(path==='/multiplayer/')await audit.locator('.featured-game').first().waitFor();assert.equal(await audit.locator('a[href*="games/checkers"]').count(),1);}
  assert.deepEqual(errors,[]);console.log('PASS catalog entry, consent-based Analytics, separate sponsors dialog and no browser exceptions');
}catch(error){failed=true;for(let i=0;i<contexts.length;i++){const p=contexts[i].pages()[0];if(p)await p.screenshot({path:`${output}/failure-${i}.png`,fullPage:true}).catch(()=>{});}console.error(error);}
finally{for(const c of contexts)await c.close();await browser.close();server.close();signal.close();}
process.exit(failed?1:0);
