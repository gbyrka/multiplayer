/** Production UI, dictionaries and WebRTC; deterministic racks are injected only by this test. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require=createRequire(import.meta.url);
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const {PeerServer}=await import(process.env.PEER_SERVER_MODULE ? pathToFileURL(process.env.PEER_SERVER_MODULE).href : 'peer');
const client=await readFile(process.env.PEERJS_SCRIPT ?? join(dirname(require.resolve('peerjs')),'peerjs.min.js'),'utf8');
const root=new URL('../../',import.meta.url),output=process.env.SCREENSHOT_DIR ?? 'test-results/scrabble';await mkdir(output,{recursive:true});
let signal;await new Promise(resolve=>PeerServer({host:'127.0.0.1',port:0,path:'/signal'},server=>{signal=server;resolve();}));
const server=createServer(async(req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!/^\/(games|multiplayer)\//.test(pathname)||pathname.includes('..'))return res.writeHead(404).end();
  const file=pathname.slice(1)+(pathname.endsWith('/')?'index.html':'');
  try {const data=await readFile(new URL(file,root));res.writeHead(200,{'Content-Type':{mjs:'text/javascript',js:'text/javascript',css:'text/css',json:'application/json',svg:'image/svg+xml',jpg:'image/jpeg',png:'image/png',gz:'application/gzip',md:'text/plain'}[file.split('.').at(-1)]??'text/html'}).end(data);}catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/multiplayer/games/scrabble/`;
const engine=process.env.SCRABBLE_ENGINE==='webkit'?webkit:chromium;
const browser=await engine.launch({headless:true,...(engine===chromium?{args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']}: {})});
const contexts=[],errors=[],requests=[];let count=0;
const pass=text=>console.log(`PASS ${++count}: ${text}`);
async function page(touch=false){
  const context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:touch,reducedMotion:'reduce'});contexts.push(context);
  await context.route('**/peerjs@1.5.5/dist/peerjs.min.js',route=>route.fulfill({contentType:'text/javascript',body:client+`\nconst OriginalPeer=window.Peer;window.Peer=class extends OriginalPeer{constructor(id,options){super(id,{...options,host:'127.0.0.1',port:${signal.address().port},path:'/signal',secure:false,config:{iceServers:[]}})}};`}));
  const p=await context.newPage();p.on('pageerror',error=>errors.push(error.message));p.on('request',r=>requests.push(r.url()));
  await p.goto(base);await p.locator('.home').waitFor();
  await p.evaluate(async()=>{
    const {GameRoom}=await import('../../shared/room.mjs');const {SoloSession}=await import('../boggle/solo-session.mjs');
    const wrap=original=>function(...args){
      window.__room=this;const adapter=this.game.adapter;
      this.game={...this.game,adapter:{...adapter,applyAction(...args){
        const next=adapter.applyAction(...args);
        if(args[2]==='START_GAME'){
          const pool=[...Object.values(next.racks).flat(),...next.bag];
          const words=next.settings.language==='en'?['catres?','tonesid','garden?','wolvesi']:['żółwkot','aienrst','adomrs?','egilnp?'];
          next.players.forEach((p,i)=>{next.racks[p.id]=[...words[i]].map(letter=>{const pos=pool.findIndex(t=>t.letter===(letter==='?'?'':letter));if(pos<0)throw new Error('Test rack unavailable: '+letter);return pool.splice(pos,1)[0];});});
          next.bag=pool;next.turnIndex=0;if(window.__shortClock)next.endsAt=performance.now()+800;
        }
        window.__state=next;return next;
      }}};return original.apply(this,args);
    };
    GameRoom.prototype.create=wrap(GameRoom.prototype.create);SoloSession.prototype.create=wrap(SoloSession.prototype.create);
    const join=GameRoom.prototype.join;GameRoom.prototype.join=function(...args){window.__room=this;return join.apply(this,args);};
  });
  return p;
}
async function settings(p,language,clock='0'){
  await p.locator('[name=language]').selectOption(language);await p.locator('[name=clock]').selectOption(clock);await p.getByRole('button',{name:'Save settings',exact:true}).click();
  await p.waitForFunction(()=>document.querySelector('[data-action=start]')?.textContent==='Start game' && document.querySelector('#settings-form button[type=submit]')?.disabled);
}
async function start(p,name='Alex',solo=true){await p.locator('#your-name').fill(name);await p.getByRole('button',{name:solo?'Play alone':'Create game',exact:true}).click();await p.locator('.lobby').waitFor();}
async function typeAt(p,index,word,touch=false){
  const square=p.locator(`[data-action=square][data-index="${index}"]`);if(touch)await square.tap();else await square.click();
  await p.keyboard.insertText(word);
}
async function fits(p){
  for(const [width,height] of [[1440,1000],[1366,768],[1024,768],[1180,820],[820,1180]]){
    await p.setViewportSize({width,height});
    const dimensions=await p.evaluate(()=>({width:document.documentElement.scrollWidth,board:document.querySelector('#board').getBoundingClientRect().toJSON(),input:document.querySelector('#word-input')?.getBoundingClientRect().toJSON()}));
    assert.ok(dimensions.width<=width+1,`Horizontal overflow at ${width}x${height}`);assert.ok(dimensions.board.right<=width,`Board clipped at ${width}`);
    if(width>=1024){assert.ok(dimensions.board.bottom<height,`Board below viewport at ${width}x${height}`);assert.ok(dimensions.input.bottom<height,`Editor below viewport at ${width}x${height}`);}
  }
}
try{
  const solo=await page(true),before=requests.filter(u=>u.includes('peerjs.min.js')).length;
  await start(solo);await settings(solo,'en');
  await solo.locator('[name=clock]').selectOption('-1');await solo.locator('[name=seconds]').fill('47');await solo.getByRole('button',{name:'Save settings',exact:true}).click();
  await solo.waitForFunction(()=>window.__room.view.settings.seconds===47);await settings(solo,'en');
  await solo.locator('[data-action=start]').click();await solo.locator('#board').waitFor();
  assert.equal(requests.filter(u=>u.includes('peerjs.min.js')).length,before);assert.equal(await solo.locator('[data-action=square]').count(),225);
  await typeAt(solo,111,'cat',true);assert.equal(await solo.locator('.square.draft').count(),3);assert.match(await solo.locator('#word-form [type=submit]').textContent(),/10 pts/);
  await solo.locator('[data-action=blanks]').click();await solo.locator('.blank-row').nth(1).getByRole('button').click();
  assert.match(await solo.locator('#word-form [type=submit]').textContent(),/8 pts/);assert.equal(await solo.locator('.square.draft .blank-mark').count(),1);
  await solo.locator('.blank-row').nth(1).getByRole('button').click();await solo.locator('[data-action=close-dialog]').click();
  await solo.keyboard.press('Backspace');assert.equal(await solo.locator('#word-input').inputValue(),'ca');await solo.keyboard.insertText('t');
  await fits(solo);await solo.setViewportSize({width:1440,height:1000});await solo.screenshot({path:`${output}/solo-preview.png`,fullPage:true});
  await solo.locator('#word-input').press('Enter');await solo.waitForFunction(()=>window.__room.view.turnSerial===2);
  assert.equal(await solo.locator('.square.occupied').count(),3);assert.doesNotMatch(await solo.locator('#board').textContent(),/null/);
  await typeAt(solo,111,'cats');assert.equal(await solo.locator('.square.draft').count(),1);assert.match(await solo.locator('#word-form [type=submit]').textContent(),/6 pts/);
  await solo.locator('#word-input').press('Enter');await solo.waitForFunction(()=>window.__room.view.turnSerial===3);assert.equal(await solo.evaluate(()=>window.__room.view.players[0].score),16);
  pass('Solo keyboard/touch placement, full-word intersections, blank choice, scoring and desktop/tablet layouts');
  await solo.locator('[data-action=exchange]').click();await solo.locator('.rack-tile').first().click();await solo.locator('[data-action=confirm-exchange]').click();
  await solo.waitForFunction(()=>window.__room.view.turnSerial===4);assert.equal(await solo.evaluate(()=>window.__room.view.rack.length),7);
  await solo.locator('[data-action=end-practice]').click();await solo.locator('[data-action=confirm-end]').click();await solo.locator('.result').waitFor();
  await solo.locator('[data-action=play-again]').click();await solo.locator('.lobby').waitFor();pass('Exchange, end practice and rematch');
  await settings(solo,'pl');await solo.locator('[data-action=start]').click();await solo.locator('#board').waitFor();
  await typeAt(solo,110,'żółw',true);assert.match(await solo.locator('#word-form [type=submit]').textContent(),/28 pts/);
  await solo.locator('#word-input').press('Enter');await solo.waitForFunction(()=>window.__room.view.history.length===1);pass('Polish input and production SGJP dictionary');
  await solo.locator('[data-action=end-practice]').click();await solo.locator('[data-action=confirm-end]').click();await solo.locator('[data-action=play-again]').click();
  await settings(solo,'en','30');await solo.evaluate(()=>{window.__shortClock=true;});await solo.locator('[data-action=start]').click();await solo.locator('#board').waitFor();await typeAt(solo,111,'cat');
  await solo.waitForFunction(()=>window.__room.view.history.at(-1)?.kind==='timeout');assert.equal(await solo.locator('.square.draft').count(),0);assert.equal(await solo.locator('#word-input').inputValue(),'');pass('Automatic per-move timeout discards uncommitted tiles');
  await solo.close();
  const host=await page();await start(host,'Host',false);await settings(host,'en');const invite=await host.locator('#invite-link').inputValue(),guests=[];
  for(let i=0;i<3;i++){
    const guest=await page(i===0);await guest.goto(invite);await guest.locator('.home').waitFor();await guest.locator('#your-name').fill(`Guest ${i+1}`);
    await guest.getByRole('button',{name:'Join game',exact:true}).click();await guest.locator('.lobby').waitFor();await guest.locator('[data-action=ready]:not(:disabled)').waitFor();await guest.locator('[data-action=ready]').click();guests.push(guest);
  }
  await host.locator('[data-action=start]:not(:disabled)').click();for(const p of [host,...guests])await p.locator('#board').waitFor();
  // Guests navigating to the invite do not need test state hooks: only the host owns the reducer.
  await typeAt(host,111,'cat');await host.locator('#word-input').press('Enter');
  await guests[0].waitForFunction(()=>document.querySelector('h1')?.textContent==='Your turn');assert.equal(await guests[0].locator('.square.occupied').count(),3);
  await typeAt(guests[0],111,'cats',true);await guests[0].locator('#word-input').press('Enter');await guests[1].waitForFunction(()=>document.querySelector('h1')?.textContent==='Your turn');
  for(const p of [host,...guests]){assert.equal(await p.locator('.square.occupied').count(),4);assert.equal(await p.locator('.standings li').count(),4);}
  pass('Four actual WebRTC peers synchronize board, racks, turns and scores');
  await host.locator('#chat-section').evaluate(node=>{node.open=true;});await host.locator('#chat-input').fill('Draft stays here');
  await guests[1].locator('#chat-section').evaluate(node=>{node.open=true;});await guests[1].locator('#chat-input').fill('Hello!');await guests[1].locator('#chat-input').press('Enter');
  await host.getByText('Hello!',{exact:true}).waitFor();assert.equal(await host.locator('#chat-input').inputValue(),'Draft stays here');
  await host.screenshot({path:`${output}/multiplayer.png`,fullPage:true});
  await guests[2].locator('[data-action=leave]').click();await guests[2].locator('[data-action=confirm-leave]').click();
  await host.getByRole('heading',{name:'Game disconnected'}).waitFor();await host.locator('[data-action=return-lobby]').click();await host.locator('.lobby').waitFor();
  assert.equal(await host.locator('.lobby-players li').count(),3);pass('Chat drafts, disconnect and lobby recovery');
  assert.deepEqual(errors,[]);console.log(`PASS: ${count} browser scenarios; no page errors.`);
}finally{for(const context of contexts)await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>signal.close(resolve));}
// PeerServer 1.0.2 retains expiration timers after server.close(). All scenarios,
// assertions and resource cleanup above are awaited; this line is unreachable on failure.
process.exit(0);
