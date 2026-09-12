#!/usr/bin/env node
/** Actual desktop Chromium <-> installed Android WebView through encrypted Morse.
 * Uses Playwright's documented Android API over owner-authorized ADB. The emulator
 * and relay must be running; never installs to or touches an arbitrary physical phone.
 * No received text is passed between peers by this harness: only the invite is copied.
 * --local-gemma selects real native LiteRT on Android; otherwise real HTTP Gemma.
 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
const {once}=require('node:events');
const ROOT=path.resolve(__dirname,'..');
const OUT=path.join(ROOT,'test-results','pc-android');fs.mkdirSync(OUT,{recursive:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const MODEL=process.env.MORSETALK_AI_MODEL||'gemma4:e2b-it-qat';
const RELAY=process.env.MORSETALK_TEST_RELAY||'ws://127.0.0.1:8788/v1';
const localGemma=process.argv.includes('--local-gemma');
const report={ok:false,desktopOS:process.platform,android:'installed debug APK in emulator',
  physicalDevices:false,publicInternet:false,transport:'AES-GCM Morse symbols / shipped localhost USB helper / actual ADB reverse to emulator',
  androidInference:localGemma?'native LiteRT Gemma 4 E2B':'Java -> actual Ollama Gemma 4 E2B',
  desktopInference:'Python -> actual Ollama Gemma 4 E2B',sameInferenceServer:!localGemma,cases:[]};
let device,browser,server,desktop,phone,sourceOrigin,beforeMappings;const errors=[];
function record(){fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(report,null,2));}
async function waitFor(fn,description,timeout=30000){
  const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn())return;await delay(100);}throw Error(`Timeout: ${description}`);
}
async function click(page,selector){
  const locator=page.locator(selector);
  await waitFor(async()=>await locator.isEnabled(),`enabled ${selector}`);
  // Drive the actual desktop/WebView DOM through browser-dispatched pointer input.
  // Native touch coordinates are tested separately by Android instrumentation.
  await locator.click();
}
function reverseMappings(){
  const result=spawnSync('adb',['-s',device.serial(),'reverse','--list'],{encoding:'utf-8',timeout:15000});
  assert.equal(result.status,0,'Cannot inspect the selected emulator reverse mappings');
  return result.stdout.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).sort();
}
async function startDesktop(){
  const relay=new URL(RELAY),port=Number(relay.port);
  assert.equal(relay.hostname,'127.0.0.1');assert.equal(relay.protocol,'ws:');
  assert.ok(port>=1024&&port<=65535,'A dedicated unused USB test port is required');
  beforeMappings=reverseMappings();
  server=spawn(process.env.PYTHON||'python3',['-X','utf8','tools/pc_android.py','--serial',device.serial(),'--port',String(port),'--no-browser'],{
    cwd:ROOT,env:{...process.env,PYTHONUNBUFFERED:'1'},stdio:['ignore','pipe','pipe']});
  let output='',error='';server.stdout.on('data',data=>{output+=data;});server.stderr.on('data',data=>{error+=data;});
  await waitFor(()=>{const m=output.match(/PC画面: (http:\/\/127\.0\.0\.1:\d+)\/ai\.html/);if(m)sourceOrigin=m[1];
    if(server.exitCode!==null)throw Error('USB desktop helper stopped: '+error.slice(0,200));return !!m;},'shipped USB helper');
  assert.ok(reverseMappings().some(line=>line.endsWith(`tcp:${port} tcp:${port}`)),'Helper did not create its reverse mapping');
  report.usbHelperCreatedMapping=true;
}
async function prepare(page,isAI){
  // Keep the application in the foreground; existing app lifecycle cleanup remains active.
  if(page===phone)await page.goto(new URL('/ai.html',page.url()).href);else await page.goto(sourceOrigin+'/ai.html');
  await waitFor(()=>page.locator('#pc-android-guide').isVisible(),'bundled setup guide');
  await click(page,'#pc-android-guide > summary');await click(page,'#use-usb');
  await page.locator('#relay-url').fill(RELAY);
  await page.locator('#dialogue-mode').selectOption(isAI?'ai':'manual');
  // Wait for the native/default capability callback before setting the explicit provider.
  if(page===phone){
    await waitFor(async()=>await page.locator('#provider').isEnabled() && (await page.locator('#ai-help').textContent()).includes('LiteRT-LM'),'native capability startup');
    await page.locator('#provider').selectOption(localGemma?'litert':'ollama');
    if(!localGemma){await page.locator('#endpoint').fill('http://127.0.0.1:11434/api/chat');await page.locator('#model').fill(MODEL);}
  }else await page.locator('#model').fill(MODEL);
  if(isAI){
    await page.locator('#consent').check();
    await page.locator('#goal').fill('日本語の短い一文で、相手の提案に具体例を一つ加える。');
  }
  // Instrument only capture counters; actual media and model APIs are not substituted.
  await page.evaluate(()=>{window.__crossCapture=0;const media=navigator.mediaDevices;
    if(media?.getUserMedia){const original=media.getUserMedia.bind(media);media.getUserMedia=(...args)=>{window.__crossCapture++;return original(...args);};}});
}
async function pair(creator,joiner){
  const limits=creator.locator('summary').filter({hasText:'会話の制限・音量'});
  await limits.click();await creator.locator('#turns').fill('4');await click(creator,'#make-online');
  const invite=await creator.locator('#invite-text').inputValue();assert.ok(invite.startsWith('MTO1.'));
  await joiner.locator('.qr-import > summary').click();await joiner.locator('#qr-input').fill(invite);
  await click(joiner,'#qr-stage');assert.equal(await joiner.locator('#qr-apply').isEnabled(),true);
  await click(joiner,'#qr-apply');assert.equal(await joiner.locator('#role').inputValue(),'1');
  assert.equal(await creator.locator('#role').inputValue(),'0');
  for(const page of [creator,joiner])await page.locator('#network-consent').check();
  await click(joiner,'#listen');await click(creator,'#listen');
  const trigger=(await creator.locator('#dialogue-mode').inputValue())==='ai'?'#start':'#manual-send';
  await waitFor(()=>creator.locator(trigger).isEnabled(),'authenticated cross-device connection',60000);
}
async function texts(page){return await page.evaluate(()=>Object.fromEntries(['local','peer'].map(kind=>[kind,
  [...document.querySelectorAll('#transcript .'+kind)].map(el=>[...el.childNodes].slice(1).map(n=>n.textContent).join(''))])));}
async function complete(creator,joiner,name,begin){
  const states=await Promise.all([texts(creator),texts(joiner)]);
  assert.deepEqual(states[0].local,states[1].peer,'A -> B exact text mismatch');
  assert.deepEqual(states[1].local,states[0].peer,'B -> A exact text mismatch');
  for(const state of states){assert.equal(state.local.length,2);assert.equal(state.peer.length,2);}
  for(const page of [creator,joiner]){
    assert.equal(await page.locator('#transcript').getByText(/が相手に到達しました。/).count(),2,'ACK count');
    assert.equal(await page.evaluate(()=>window.__crossCapture),0,'Online mode accessed camera/microphone');
  }
  report.cases.push({name,ok:true,creator:creator===desktop?'desktop':'android',turns:4,
    exactReceived:4,acknowledged:4,elapsedSeconds:(Date.now()-begin)/1000,transcripts:states});record();
  console.log('PASS cross-device '+name);
  await click(creator,'#stop');
  await waitFor(()=>joiner.locator('#stop').isDisabled(),'peer disconnect stops the other device');
  await waitFor(()=>joiner.locator('#listen').isEnabled(),'peer becomes restartable');
}
async function manualCase(reverse){
  await prepare(desktop,false);await prepare(phone,false);
  const a=reverse?phone:desktop,b=reverse?desktop:phone;await pair(a,b);const begin=Date.now();
  const messages=['PCとスマートフォンの交信です。🙂','はい、モールスで届いています。','音楽について話してみよう。','静かな曲を選ぶ理由も考えよう。'];
  for(let i=0;i<messages.length;i++){
    const sender=i%2?b:a,receiver=i%2?a:b;
    await waitFor(()=>sender.locator('#manual-send').isEnabled(),'manual alternating turn');
    await sender.locator('#manual-message').fill(messages[i]);await click(sender,'#manual-send');
    await waitFor(async()=>(await receiver.locator('#transcript .peer').last().textContent()).includes(messages[i]),'exact manual receive');
    await waitFor(async()=>(await sender.locator('#transcript').textContent()).includes(`ターン ${i+1} が相手に到達`),'manual ACK');
  }
  assert.equal(await a.locator('#consent').isChecked(),false);assert.equal(await b.locator('#consent').isChecked(),false);
  await complete(a,b,reverse?'Android initiates -> PC manual chat':'PC initiates -> Android manual chat',begin);
}
async function mixedCase(){
  await prepare(desktop,false);await prepare(phone,true);await pair(desktop,phone);const begin=Date.now();
  for(const prompt of ['歌詞のない音楽の魅力を一つ教えて。','その魅力が伝わる楽器の例を教えて。']){
    await waitFor(()=>desktop.locator('#manual-send').isEnabled(),'human reply turn',120000);
    await desktop.locator('#manual-message').fill(prompt);await click(desktop,'#manual-send');
    const want=prompt.startsWith('歌詞')?1:2;
    await waitFor(async()=>await desktop.locator('#transcript .peer').count()===want,'actual Android Gemma reply',150000);
    await waitFor(async()=>await phone.locator('#transcript').getByText(/が相手に到達しました。/).count()===want,'Gemma reply ACK');
  }
  await complete(desktop,phone,'PC human text <-> Android real Gemma',begin);
}
async function aiCase(){
  await prepare(desktop,true);await prepare(phone,true);
  await desktop.locator('#topic').fill('少ない材料で楽しく料理する工夫を話そう。');
  await pair(desktop,phone);const begin=Date.now();await click(desktop,'#start');
  await waitFor(async()=>await desktop.locator('#turn-count').textContent()==='4 / 4' &&
    await phone.locator('#turn-count').textContent()==='4 / 4','Gemma conversation reaches limit',300000);
  await waitFor(async()=>await phone.locator('#transcript').getByText(/が相手に到達しました。/).count()===2,'final acoustic-frame ACK');
  await complete(desktop,phone,'Desktop Gemma <-> Android Gemma; 1 human seed + 3 generated turns',begin);
}
(async()=>{
  try{
    const modulePath=process.env.MORSETALK_PLAYWRIGHT_MODULE||'playwright';
    const {chromium,_android}=require(modulePath);
    const devices=await _android.devices();assert.equal(devices.length,1,'Use exactly one test emulator');device=devices[0];
    assert.ok(device.serial().startsWith('emulator-'),'This CI proof intentionally refuses physical phones');
    report.androidVersion=(await device.shell('getprop ro.build.version.release')).toString().trim();
    report.deviceModel=device.model();
    await device.shell('am force-stop jp.morsetalk.app');
    await device.shell('am start -W -n jp.morsetalk.app/.MainActivity');
    const view=await device.webView({pkg:'jp.morsetalk.app'});phone=await view.page();
    await waitFor(()=>phone.url().startsWith('https://appassets.androidplatform.net/'),'installed app URL');
    phone.on('pageerror',e=>errors.push({side:'android',error:String(e)}));
    assert.ok(phone.url().startsWith('https://appassets.androidplatform.net/'),'Must use installed bundled app, not a mobile viewport');
    await startDesktop();browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    desktop=await browser.newPage({viewport:{width:1280,height:1000}});desktop.on('pageerror',e=>errors.push({side:'desktop',error:String(e)}));
    const inventory=await (await fetch('http://127.0.0.1:11434/api/tags')).json();
    assert.ok(inventory.models.some(m=>m.name===MODEL&&m.digest),'Real Gemma model must be installed; no canned fallback');
    report.model=MODEL;report.modelDigest=inventory.models.find(m=>m.name===MODEL).digest;
    await manualCase(false);await manualCase(true);await mixedCase();await aiCase();
    assert.equal(errors.length,0,JSON.stringify(errors));report.pageErrors=errors;report.ok=true;
  }catch(error){report.error=String(error).replace(/MTO1\.[A-Za-z0-9_-]+/g,'[REDACTED_INVITATION]');report.pageErrors=errors;process.exitCode=1;console.error(report.error);}
  finally{
    // No invitation text, secrets or live QR pixels enter evidence.
    for(const [page,side] of [[desktop,'desktop'],[phone,'android']])if(page){
      try{await page.evaluate(()=>{for(const id of ['invite-text','qr-input']){const el=document.getElementById(id);if(el)el.value='';}const qr=document.getElementById('qr-output');if(qr)qr.hidden=true;});
        await page.screenshot({path:path.join(OUT,side+'.png'),fullPage:true});}catch{}
    }
    if(browser)await browser.close().catch(()=>{});
    if(device)await device.shell('am force-stop jp.morsetalk.app').catch(()=>{});
    if(server){
      server.kill('SIGINT');await Promise.race([once(server,'exit').catch(()=>{}),delay(10000)]);
      if(server.exitCode===null){server.kill('SIGKILL');report.ok=false;report.cleanupError='USB helper failed to exit gracefully';process.exitCode=1;}
      try{report.usbHelperCleanedUp=JSON.stringify(reverseMappings())===JSON.stringify(beforeMappings);
        if(!report.usbHelperCleanedUp){report.ok=false;process.exitCode=1;}}
      catch(e){report.ok=false;report.cleanupError=String(e);process.exitCode=1;}
    }
    if(device)await device.close().catch(()=>{});
    record();console.log(JSON.stringify(report,null,2));
  }
})();
