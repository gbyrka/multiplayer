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
const origin = `http://127.0.0.1:${server.address().port}`, base = origin + '/multiplayer/games/chess/';
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
      window.__chessRoom=this;
      this.game={...this.game,adapter:{...this.game.adapter,applyAction(...args){
        let next;
        if(window.__fixture){
          next=structuredClone(args[0]);Object.assign(next,{phase:'playing',fen:window.__fixture.fen,history:[],positions:{},drawOffer:null,result:null,clock:null},window.__fixture);
          next.revision++;core.adjudicate(next);window.__fixture=null;
        }else next=core.applyAction(...args);
        window.__state=next;return next;
      }}};
      return original.apply(this,args);
    };
    GameRoom.prototype.join=function(...args){window.__chessRoom=this;return join.apply(this,args);};
    window.__setFixture=fixture=>{window.__fixture=fixture;window.__chessRoom.act('CHESS_ACTION',{action:'OFFER_DRAW'});};
  });
}
const clickSquare=async(p,s)=>{const node=p.locator(`[data-square="${s}"]`);if(await p.evaluate(()=>navigator.maxTouchPoints>0))await node.tap();else await node.click();};
const play=async(p,a,b)=>{await clickSquare(p,a);await clickSquare(p,b);};
async function noOverflow(p,width){await p.setViewportSize({width,height:1050});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow at ${width}px`);}
async function fixture(p,fen,extra={}){await p.evaluate(({fen,extra})=>window.__setFixture({fen,...extra}),{fen,extra});await p.waitForTimeout(50);}
try {
  const host=await page();await host.goto(base);await host.locator('.home').waitFor();await hooks(host);
  assert.equal(await host.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
  for(const width of [320,390,768,1024,1440])await noOverflow(host,width);
  await host.screenshot({path:`${output}/home-1440.png`,fullPage:true});
  await host.locator('#your-name').fill('Alex');await host.getByRole('button',{name:'CREATE A TABLE ↗',exact:true}).click();await host.locator('.lobby').waitFor();
  await host.locator('select[name="hostColor"]').selectOption('b');await host.locator('#use-clock').check();await host.locator('#clock-minutes').fill('5');
  assert.equal(await host.locator('[data-action="start"]').isDisabled(),true);
  await host.getByRole('button',{name:'SAVE SETTINGS'}).click();
  const invite=await host.locator('#invite-link').inputValue();assert.match(invite,/games\/chess\/\?room=/);
  const guest=await page(true);await guest.goto(invite);await guest.locator('.home').waitFor();await hooks(guest);
  await guest.locator('#your-name').fill('Sam');await guest.getByRole('button',{name:'JOIN THE TABLE ↗',exact:true}).click();await guest.locator('.lobby').waitFor();
  assert.match(await guest.locator('.guest-settings').innerText(),/Host plays Black.*5 min/);
  await guest.getByRole('button',{name:'I’M READY'}).click();await host.locator('[data-action="start"]:not(:disabled)').waitFor();
  for(const width of [320,390,768,1024,1440])await noOverflow(host,width);
  await host.screenshot({path:`${output}/lobby-1440.png`,fullPage:true});
  await host.locator('[data-action="start"]').click();await host.locator('.chess-board').waitFor();await guest.locator('.game').waitFor();
  assert.equal(await host.locator('.square').first().getAttribute('data-square'),'h1');assert.equal(await guest.locator('.square').first().getAttribute('data-square'),'a8');
  assert.equal(await host.locator('.can-move').count(),0);assert.equal(await guest.locator('.can-move').count(),10);
  await clickSquare(guest,'e2');assert.deepEqual((await guest.locator('.legal-target').evaluateAll(n=>n.map(x=>x.dataset.square))).sort(),['e3','e4']);assert.equal(await guest.locator('.can-move').count(),0);
  await guest.keyboard.press('Escape');
  for(const width of [320,390,768,1024,1440]){await noOverflow(guest,width);if(width===390||width===1440)await guest.screenshot({path:`${output}/white-${width}.png`,fullPage:true});}
  await host.screenshot({path:`${output}/black-1440.png`,fullPage:true});
  await guest.locator('#chat-input').fill('Good luck!');await guest.locator('.chat-send').click();await host.getByText('Good luck!',{exact:true}).waitFor();
  await guest.locator('#chat-input').fill('A draft stays here.');
  await play(guest,'e2','e4');await host.locator('.can-move').first().waitFor();assert.equal(await guest.locator('#chat-input').inputValue(),'A draft stays here.');
  assert.equal(await host.locator('[data-square="e4"] .piece-w').count(),1);
  const clocks=await host.evaluate(()=>window.__chessRoom.view.clock);assert.ok(clocks.w<300000&&clocks.b<=300000);
  console.log('PASS actual two-player WebRTC, host color/time choices, opposite perspectives, legal selection, touch, chat and clocks');

  await fixture(host,'k3r3/8/8/8/8/8/4B3/4K3 w - - 0 1');
  assert.equal(await guest.locator('[data-square="e2"]').isDisabled(),true);assert.equal(await guest.locator('[data-square="e2"]').getAttribute('class').then(x=>x.includes('can-move')),false);
  await fixture(host,'k3r3/8/8/8/8/8/8/R3K3 w - - 0 1');
  assert.equal(await guest.locator('#game-status h1').innerText(),'CHECK');assert.equal(await guest.locator('.in-check').getAttribute('data-square'),'e1');
  assert.equal(await guest.locator('[data-square="a1"]').isDisabled(),true);
  await guest.screenshot({path:`${output}/check.png`,fullPage:true});
  await fixture(host,'7k/P7/8/8/8/8/8/4K3 w - - 0 1');
  await play(guest,'a7','a8');await guest.locator('.promotion-panel').waitFor();assert.equal(await guest.locator('.promotion-choice').count(),4);
  await guest.getByRole('button',{name:'Promote to knight',exact:true}).click();await guest.locator('[data-square="a8"] .piece-w').waitFor();assert.equal(await guest.locator('#game-status h1').innerText(),'DRAW');
  await fixture(host,'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');await play(guest,'e1','g1');await guest.locator('[data-square="f1"] .piece').waitFor();assert.equal(await guest.locator('[data-square="f1"] .piece').count(),1);
  await fixture(host,'4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');await play(guest,'e5','d6');await guest.locator('[data-square="d5"] .piece').waitFor({state:'detached'});assert.equal(await guest.locator('[data-square="d5"] .piece').count(),0);
  console.log('PASS pinned/blocked pieces, check evasion, underpromotion, castling and en passant through the interface');

  await fixture(host,'7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');await host.getByRole('heading',{name:'STALEMATE · DRAW'}).waitFor();assert.equal(await host.locator('.legal-target').count(),0);await host.screenshot({path:`${output}/stalemate.png`,fullPage:true});
  await fixture(host,'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  for(const [p,a,b] of [[guest,'f2','f3'],[host,'e7','e5'],[guest,'g2','g4'],[host,'d8','h4']])await play(p,a,b);
  await guest.getByRole('heading',{name:'CHECKMATE',exact:true}).waitFor();assert.match(await guest.locator('#game-status').innerText(),/Alex wins with Black/);await host.screenshot({path:`${output}/checkmate.png`,fullPage:true});
  await host.locator('[data-action="play-again"]').click();await guest.locator('.lobby').waitFor();assert.equal(await guest.locator('[data-action="ready"]').innerText(),'I’M READY');assert.equal(await host.getByText('Good luck!',{exact:true}).count(),1);
  await guest.locator('[data-action="ready"]').click();await host.locator('[data-action="start"]:not(:disabled)').click();await guest.locator('.game').waitFor();
  await host.evaluate(()=>window.__setFixture({fen:'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',clock:{w:400,b:60000,running:'w',since:performance.now()}}));
  await guest.getByRole('heading',{name:'TIME’S UP',exact:true}).waitFor();assert.match(await host.locator('#game-status').innerText(),/Alex wins with Black/);
  console.log('PASS stalemate, checkmate, rematch readiness and automatic authoritative timeout');

  for(const path of ['/multiplayer/','/multiplayer/?game=plan','/multiplayer/games/tow/','/multiplayer/games/hamster/','/multiplayer/games/catana/','/multiplayer/games/chess/']){
    const p=await page();const requests=[];p.on('request',r=>{if(r.url().includes('googletagmanager.com'))requests.push(r.url());});
    await p.goto(origin+path);await p.waitForFunction(()=>document.documentElement.dataset.appVersion&&typeof window.gtag==='function');
    assert.equal(requests.length,0);
    const gaRequest=p.waitForRequest('**/www.googletagmanager.com/**');
    await p.evaluate(()=>{window.googlefc.getGoogleConsentModeValues=()=>({analyticsStoragePurposeConsentStatus:1});window.googlefc.callbackQueue.find(x=>x.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY();});
    await gaRequest;await p.waitForFunction(()=>document.querySelector('script[src*="googletagmanager"]'));assert.equal(requests.length,1);assert.match(requests[0],/G-WTPHWDLQ7K/);
    await p.evaluate(()=>{window.googlefc.getGoogleConsentModeValues=()=>({analyticsStoragePurposeConsentStatus:2});window.googlefc.callbackQueue.find(x=>x.CONSENT_MODE_DATA_READY).CONSENT_MODE_DATA_READY();window.gtag('event','denied_test');});
    assert.ok(await p.evaluate(()=>!window.dataLayer.some(x=>x[1]==='denied_test')));await p.close();
  }
  const list=await page();await list.goto(origin+'/multiplayer/');await list.locator('.featured-game').first().waitFor();assert.equal(await list.locator('a[href*="games/chess"]').count(),0);
  await list.goto(origin+'/games/');assert.equal(await list.locator('a[href*="games/chess"]').count(),0);
  await host.goto(base);await host.locator('.home').waitFor();const ad=host.locator('#chess-ad');await ad.scrollIntoViewIfNeeded();assert.equal(await ad.locator('.adsbygoogle').count(),1);
  const spacing=await host.evaluate(()=>document.querySelector('#chess-ad').getBoundingClientRect().top-document.querySelector('#page-layout').getBoundingClientRect().bottom);assert.ok(spacing>=149);
  assert.deepEqual(errors,[]);
  console.log('PASS Analytics on PLAN/TOW/HAMSTER/Catana/CHESS, consent handling, unlisted entry, separated ad placement and no browser exceptions');
}catch(error){failed=true;for(let i=0;i<contexts.length;i++){const p=contexts[i].pages()[0];if(p)await p.screenshot({path:`${output}/failure-${i}.png`,fullPage:true}).catch(()=>{});}console.error(error);}
finally{for(const c of contexts)await c.close();await browser.close();server.close();signal.close();}
// PeerServer heartbeat timers do not expose a public disposal API.
process.exit(failed?1:0);
