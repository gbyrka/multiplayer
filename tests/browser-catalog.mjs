/** Single catalog migration: real pages, local siblings, no public ad/analytics requests. */
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPreviewServer} from '../../gbyrka.github.io/tools/preview.mjs';
const {chromium,webkit}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const engine=process.env.CATALOG_ENGINE==='webkit'?webkit:chromium,server=createPreviewServer();
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,browser=await engine.launch({headless:true}),output=process.env.SCREENSHOT_DIR??'/tmp/catalog-migration';
await mkdir(output,{recursive:true});
const contexts=[],errors=[],missing=[];let checks=0;
const pass=label=>console.log(`PASS ${++checks}: ${label}`);
async function context(js=true){const c=await browser.newContext({javaScriptEnabled:js,reducedMotion:'reduce',viewport:{width:1280,height:950}});contexts.push(c);await c.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['blob:','data:'].includes(url.protocol)?route.continue():route.abort();});c.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400&&!r.url().endsWith('/favicon.ico'))missing.push(r.url());});});return c;}
try{
 const c=await context(),p=await c.newPage();await p.goto(origin+'/');await p.waitForFunction(()=>document.documentElement.dataset.appVersion==='home19nov1');
 const cards=p.locator('.game-card'),destinations=await cards.evaluateAll(nodes=>nodes.map(a=>new URL(a.href).pathname+new URL(a.href).search));
 assert.equal(destinations.length,13);assert.equal(new Set(destinations).size,13);assert.equal(await p.locator('#keyboard .game-card').first().locator('h3').textContent(),'SimCity');
 assert.equal(await p.locator('link[rel=canonical]').getAttribute('href'),'https://mod-it.games/');assert.equal(await p.locator('meta[property="og:url"]').getAttribute('content'),'https://mod-it.games/');
 await p.locator('img').evaluateAll(images=>Promise.all(images.map(img=>{img.loading='eager';return img.decode();})));
 for(const width of [320,390,540,768,900,1024,1280,1440]){await p.setViewportSize({width,height:950});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await p.locator('#asset-error').isVisible(),false);if([390,1440].includes(width))await p.screenshot({path:`${output}/catalog-${width}.png`,fullPage:true});}
 pass('The root has all 13 original illustrated cards, SimCity first in Keyboard, working local images and responsive layout');
 for(const path of ['/games/','/games','/games/index.html']){
  const suffix='?campaign=simcity&encoded=a%2Bb#keyboard';await p.goto(origin+path+suffix);await p.waitForURL(origin+'/'+suffix);await p.waitForFunction(()=>document.documentElement.dataset.appVersion);assert.equal(await cards.count(),13);assert.equal(await p.locator('ins.adsbygoogle').count(),1);
 }
 await p.goto(origin+'/dock/');await p.goto(origin+'/games/#multiplayer');await p.waitForURL(origin+'/#multiplayer');await p.goBack();assert.equal(new URL(p.url()).pathname,'/dock/');
 pass('Old catalog URLs redirect directly to root, preserve queries/fragments and do not trap Back navigation');
 for(const path of [...destinations,'/multiplayer/','/multiplayer/games/scrabble/','/games/pop/','/games/privacy.html']){
  await p.goto(origin+path);await p.waitForLoadState('load');
  if(path.startsWith('/multiplayer/'))await p.waitForFunction(()=>document.documentElement.dataset.appVersion);
  if(path.startsWith('/games/')&&path!=='/games/privacy.html')await p.waitForFunction(()=>document.querySelector('#boot').hidden);
  const stale=await p.locator('a[href]').evaluateAll(nodes=>nodes.filter(a=>new URL(a.href).pathname==='/games/').map(a=>a.outerHTML));assert.deepEqual(stale,[],path);
  const footer=p.locator('footer a[href="/"], .privacy-footer a[href="/"]');
  const home=await footer.count()?footer.first():p.getByRole('link',{name:/^(All games|← Browse all games|Browse all games|← Back to MoD-IT Games)$/}).first();await home.waitFor();assert.equal(await home.evaluate(a=>new URL(a.href).pathname),'/');// WebKit's automated scroll can stall inside the animated HAMSTER viewport.
  // Chromium exercises physical clicks; WebKit activates the same DOM anchor.
  if(engine.name()==='webkit')await home.evaluate(anchor=>anchor.click());else await home.click();await p.waitForURL(origin+'/');await p.locator('#main .game-card').first().waitFor();
 }
 pass('Every public game, unlisted SCRABBLE/POP, multiplayer collection and privacy page return straight to the root catalog');
 const plain=await context(false),plainPage=await plain.newPage();await plainPage.goto(origin+'/');assert.equal(await plainPage.locator('.game-card').count(),13);assert.equal(await plainPage.locator('.game-card img').count(),13);await plainPage.goto(origin+'/games/');await plainPage.waitForURL(origin+'/');assert.equal(await plainPage.locator('.game-card').count(),13);await plainPage.locator('a[href="/sokoban/"]').click();assert.equal(new URL(plainPage.url()).pathname,'/sokoban/');
 pass('The illustrated homepage and old-address fallback both work without JavaScript');
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);pass('No missing local files or uncaught browser errors');console.log(`${checks} catalog migration checks passed in ${engine.name()}.`);
}catch(error){for(const [i,c]of contexts.entries())for(const p of c.pages())await p.screenshot({path:`${output}/failure-${i}.png`,fullPage:true}).catch(()=>{});throw error;}
finally{for(const c of contexts)await c.close();await browser.close();await new Promise(r=>server.close(r));}
