import { packFastFrame, unpackFastFrame, fastPcm, fastDuration, FastMorseDecoder } from '../core/fast-codec.mjs';
import { prepareMessage } from '../core/packet.mjs';
import { pcmToWav } from '../core/morse.mjs';
import { ReliableMorseLink, MorseAgent } from '../core/fast-link.mjs';
import { FastAudio } from './fast-audio.mjs';
import { aiCapabilities, generateReply } from './ai-client.mjs';
import { hasNative, nativeCall, setAwake } from './voice.mjs';
import { createExperience } from './ai-experience.mjs';
const $=id=>document.getElementById(id);
let audio=null,agent=null,link=null,virtualAgents=[],busy=false,generation=0,testAbort=null,localImport=null;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let experience=null,localState=null,localTimer=null,localRefresh=0,awake=false;
function pollLocal(){
  if(localTimer||!hasNative()||document.hidden)return;
  localTimer=setTimeout(async()=>{localTimer=null;try{await refreshLocal();}catch{}
    if(busy||localState?.busy||localImport||agent?.busy||virtualAgents.some(a=>a.busy))pollLocal();
  },700);
}
function status(text){$('status').textContent=text;experience?.stage(text);}
function entry(label,text,kind='event'){
  $('transcript').querySelector('.empty')?.remove();
  const box=document.createElement('div');box.className=`entry ${kind}`;
  const name=document.createElement('small');name.textContent=label;box.append(name,document.createTextNode(text));$('transcript').append(box);
  while($('transcript').children.length>200)$('transcript').firstElementChild.remove();
  $('transcript').scrollTop=$('transcript').scrollHeight;
}
function options(){
  const room=$('room').value,sessionText=$('session').value;
  if(!/^[0-9a-fA-F]{8}$/.test(sessionText))throw new Error('セッションは8桁の16進数です。');
  const session=parseInt(sessionText,16),sender=Number($('role').value),wpm=Number($('speed').value),volume=Number($('volume').value),maxTurns=Number($('turns').value),maxReplyBytes=Number($('max-bytes').value);
  packFastFrame({room,session,sender,seq:1,text:'test'});
  if(!Number.isInteger(maxTurns)||maxTurns<2||maxTurns>32||!Number.isInteger(maxReplyBytes)||maxReplyBytes<32||maxReplyBytes>512)throw new Error('会話制限の数値を確認してください。');
  if(![120,300,600,1200].includes(wpm)||!Number.isFinite(volume)||volume<.03||volume>.35)throw new Error('速度・音量の設定が不正です。');
  return {room,session,sender,wpm,volume,maxTurns,maxReplyBytes,frequency:4000,goal:$('goal').value};
}
function aiOptions(){
  if(!$('consent').checked)throw new Error('会話文をAIに渡すことを許可してください。');
  const model=$('model').value.trim();if(!model)throw new Error('導入済みモデル名を入力してください。');
  return {model,endpoint:$('endpoint').value,provider:$('provider').value,backend:$('local-backend').value,consent:true};
}
function controls(){
  const running=Boolean(audio||virtualAgents.length||busy||localState?.busy);
  experience?.lock(running);
  if(running)pollLocal();
  if(awake!==running){awake=running;setAwake(running);}
  $('listen').disabled=running;$('start').disabled=!agent||!agent.active||agent.history.length>0||Number($('role').value)!==0;
  $('stop').disabled=!running;$('quick-stop').disabled=!running;$('clear').disabled=running;$('self-test').disabled=running;$('ai-pair').disabled=running;$('test-ai').disabled=running;$('export-fast').disabled=running;
  for(const id of ['role','speed','room','session','model','goal','topic','turns','max-bytes','volume','consent'])$(id).disabled=running;
  if(hasNative()){ $('endpoint').disabled=running||$('provider').value==='litert';$('provider').disabled=running; }
  for(const id of ['import-model','load-model','unload-model','local-backend','model-guide'])$(id).disabled=running;
  if($('provider').value==='litert')$('model').disabled=true;
  if(localImport)$('import-model').disabled=true;
}
function stop(message='停止しました。'){
  if(hasNative())nativeCall('cancelAI',{},1000).then(()=>refreshLocal()).catch(()=>{});
  ++generation;agent?.stop();agent=null;link?.close();link=null;
  virtualAgents.forEach(a=>a.stop());virtualAgents=[];audio?.stop();audio=null;testAbort?.abort();testAbort=null;busy=false;setAwake(false);$('level').value=0;experience?.finish();status(message);controls();
}
function onLinkEvent(e){
  experience?.record(e);
  if(e.kind==='transmit'){entry('モールス送信',`ターン ${e.seq} · ${e.bytes} bytes${e.attempt?' · 再送':''}`);status('モールス送信 → 相手の受信確認待ち');}
  if(e.kind==='delivered'){entry('受信確認',`ターン ${e.seq} が相手に到達しました。`);status('受信確認済み。相手の応答を待っています。');}
  if(e.kind==='duplicate')entry('重複抑制',`ターン ${e.seq} は受信済み。AIには二重に渡しません。`);
  if(e.kind==='timeout')entry('受信確認待ち',e.attempt?'再送でも応答がありません。':'再送を試みます。');
  if(e.kind==='error'||e.kind==='invalid')entry('通信診断',e.message);
}
function agentEvents(label,opts){return e=>{
  experience?.record({...e,sender:opts.sender});
  if(e.kind==='thinking')status(`${label} が応答を生成中…`);
  if(e.kind==='generated'){
    entry(`${label} · ターン ${e.seq}`,e.text,'local');$('inference').textContent=`${(e.inferenceMs/1000).toFixed(2)} s`;
    const b=packFastFrame({...opts,sender:label.endsWith('B')?1:0,seq:e.seq,text:e.text});$('airtime').textContent=`${fastDuration(b,opts).toFixed(3)} s`;
  }
  if(e.kind==='peer')entry(`相手 · ターン ${e.seq}`,e.text,'peer');
  if(e.kind==='complete'){status('ターン上限に到達。AIの自動応答は終了しました。受信は「すべて停止」で終了します。');controls();}
  if(e.kind==='error'){entry('停止理由',e.message);stop(e.message);}
};}
async function beginListening(){
  const opts=options(),cfg=aiOptions();
  if(cfg.provider==='litert'&&localState?.installed===false)throw new Error('先にGemmaモデルを取り込んでください。');
  busy=true;const epoch=++generation;experience.start('microphone');controls();
  const engine=new FastAudio(opts);audio=engine;
  try{
    const actual=await engine.start(e=>{
      if(epoch!==generation)return;
      if(e.kind==='frame')link?.receive(e.frame).catch(err=>{if(epoch===generation)stop(err.message);});
      if(e.kind==='level')$('level').value=e.level;
      if(e.kind==='error')entry('受信診断',e.message);
      if(e.kind==='fatal'){entry('停止理由',e.message);stop(e.message);}
    });
    if(epoch!==generation){engine.stop();return;}
    const ack=packFastFrame({...opts,seq:1,type:'ack'});
    link=new ReliableMorseLink({...opts,sendAudio:bytes=>engine.transmit(bytes),ackDelayMs:400,ackTimeoutMs:Math.ceil(fastDuration(ack,opts)*1000+1400),onEvent:onLinkEvent});
    agent=new MorseAgent({...opts,link,generate:(messages,args)=>generateReply(messages,{...cfg,...args}),onEvent:agentEvents(`AI ${opts.sender?'B':'A'}`,opts)});
    setAwake(true);entry('マイク受信',`${actual.sampleRate} Hz · ${opts.wpm} WPM · 4,000 Hz。端末外の音を受信します。`);
    status(opts.sender?'B：受信待機中。Aから会話を開始してください。':'A：受信待機中。「Aから会話を開始」を押してください。');
  }catch(e){if(epoch===generation)stop(e.message);}
  finally{if(epoch===generation){busy=false;controls();}}
}
function pcmChannel(bytes,opts){
  const frames=[],errors=[],d=new FastMorseDecoder({...opts,sampleRate:48000,onFrame:f=>frames.push(f),onError:e=>errors.push(e)}),a=fastPcm(bytes,{...opts,sampleRate:48000});
  d.push(new Float32Array(1777));
  for(let i=0;i<a.pcm.length;i+=128)d.push(a.pcm.subarray(i,i+128));
  if(errors.length||frames.length!==1)throw new Error(`PCM復号に失敗：${errors.join(' / ')}`);
  return {frame:frames[0],seconds:a.seconds};
}
async function selfTest(){
  const opts=options(),text=$('sample-text').value,b=packFastFrame({...opts,seq:1,text});
  const rows=[];for(const wpm of [120,300,600,1200]){
    const {frame,seconds}=pcmChannel(b,{...opts,wpm});if(frame.text!==text)throw new Error('本文が一致しません。');rows.push(`${wpm} WPM: ${seconds.toFixed(3)}秒`);
  }
  let comparison='';try{const old=prepareMessage({text,room:opts.room,id:20260911,mode:'packet',wpm:40});comparison=` / 旧MT1・40 WPM: ${old.seconds.toFixed(3)}秒`;}catch{}
  $('diagnostic').textContent=`4速度すべてPCM復元一致。${rows.join(' / ')}${comparison}。これは生成音の長さです。実機通信・AI推論・ACKの時間は含みません。`;
  entry('通信自己診断 · AIなし',`「${text}」を4速度のPCMから復元。AIは呼び出していません。`);
  status('通信自己診断に成功。実機の受信待機・AI推論は開始していません。');
  $('airtime').textContent=`${fastDuration(b,opts).toFixed(3)} s`;
}
async function testAI(){
  const cfg=aiOptions();busy=true;const epoch=++generation;experience.start('ai-connection-test');testAbort=new AbortController();controls();status('指定AIへ接続中。音声は送信しません。');
  try{
    const text=await generateReply([{role:'system',content:'Return only the single word OK. No tools.'},{role:'user',content:'Connection test.'}],{...cfg,signal:testAbort.signal});
    if(epoch===generation){entry('実AIの接続応答',text);status('AI APIから文章を受信しました。会話内容の品質や2台の音響経路は別途確認が必要です。');}
  }catch(e){if(epoch===generation)status(e.message);}
  finally{if(epoch===generation){busy=false;testAbort=null;experience.finish();refreshLocal().catch(()=>{});controls();}}
}
async function aiPair(){
  const opts=options(),cfg=aiOptions();busy=true;const epoch=++generation;experience.start('numeric-pcm');controls();
  let links;const virtualCfg={...opts,maxTurns:Math.min(opts.maxTurns,8)};
  try{
    entry('検証モード','実際のAI APIを2役で呼び出します。両者の文章は必ずPCMモールスへ変換して復号しますが、音は鳴らさず、実時間での再生もしません。');
    links=[0,1].map(sender=>new ReliableMorseLink({...opts,sender,ackDelayMs:0,ackTimeoutMs:500,maxRetries:0,onEvent:onLinkEvent,sendAudio:async bytes=>{
      const {frame,seconds}=pcmChannel(bytes,opts);
      if(frame.type==='data')entry('PCM仮想経路',`生成音 ${seconds.toFixed(3)}秒分を数値処理で復号。実機の所要時間ではありません。`);
      setTimeout(()=>{if(epoch===generation)links[1-sender].receive(frame);},0);
    }}));
    virtualAgents=links.map((l,i)=>new MorseAgent({...virtualCfg,link:l,generate:(messages,args)=>generateReply(messages,{...cfg,...args}),onEvent:agentEvents(`AI ${i?'B':'A'}`,{...opts,sender:i})}));
    busy=false;controls();await virtualAgents[0].start($('topic').value);
    while(epoch===generation&&virtualAgents.some(a=>a.active))await sleep(50);
    if(epoch===generation){virtualAgents.forEach(a=>a.stop());virtualAgents=[];experience.finish();refreshLocal().catch(()=>{});status('実AI×2のPCM仮想経路テストが終了しました。実機間通信ではありません。');controls();}
  }catch(e){if(epoch===generation)stop(e.message);}
}
async function exportWav(){
  const opts=options(),data=packFastFrame({...opts,seq:1,text:$('sample-text').value}),a=fastPcm(data,{...opts,sampleRate:48000}),bytes=pcmToWav(a.pcm,48000),filename=`MorseTalk-MT2-${opts.wpm}wpm.wav`;
  if(hasNative()){
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    await nativeCall('saveFile',{filename,mime:'audio/wav',base64:btoa(binary)},180000);
  }else{
    const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('diagnostic').textContent=`${filename} · ${a.seconds.toFixed(3)}秒。CRCを含む実モールス波形です。`;
}
function handle(id,fn){$(id).addEventListener('click',()=>{Promise.resolve().then(fn).catch(e=>{status(e.message);entry('操作エラー',e.message);});});}
experience=createExperience({options,changed:()=>{controls();status('接続設定を更新しました。相手にも同じ接続コードを適用してください。');},error:e=>{status(e.message);entry('操作エラー',e.message);}});
handle('quick-stop',()=>stop());
handle('listen',beginListening);handle('start',async()=>{if(agent){$('start').disabled=true;await agent.start($('topic').value);controls();}});handle('stop',()=>stop());handle('self-test',selfTest);handle('test-ai',testAI);handle('ai-pair',aiPair);handle('export-fast',exportWav);handle('clear',()=>{$('transcript').replaceChildren();experience.clear();});
$('role').addEventListener('change',controls);
function providerChanged(){
  const local=hasNative()&&$('provider').value==='litert';
  $('local-model-controls').hidden=!local;
  if(local){$('endpoint').value='端末内 · ネット接続なし';$('model').value='gemma-4-E2B-it.litertlm';}
  else if(hasNative()){$('endpoint').value=$('provider').value==='ollama'?'http://127.0.0.1:11434/api/chat':'http://127.0.0.1:8080/v1/chat/completions';$('model').value=$('provider').value==='ollama'?'gemma4:e2b-it-qat':'';}
  controls();experience.refresh();
}
$('provider').addEventListener('change',providerChanged);
async function refreshLocal(){
  if(!hasNative())return;
  const ticket=++localRefresh;
  const c=await nativeCall('localModelStatus',{},5000);
  if(ticket!==localRefresh)return;
  localState=c;experience?.model(c);
  if($('local-model-status').textContent!==c.description)$('local-model-status').textContent=c.description;controls();
}
handle('model-guide',async()=>{await nativeCall('openModelGuide',{},5000);});
handle('import-model',async()=>{
  if(!hasNative())throw new Error('Androidアプリで使用してください。');
  if(localImport)throw new Error('モデルの選択・取り込みは開始済みです。');
  // The picker pauses the Activity. Its return event starts the cancellable copy state.
  const operation={epoch:null};localImport=operation;$('import-model').disabled=true;
  try{
    const c=await nativeCall('importModel',{},600000);
    if(operation.epoch===null||operation.epoch===generation)$('local-model-status').textContent=c.description;
  }catch(e){
    if(operation.epoch===null||operation.epoch===generation){nativeCall('cancelAI',{},1000).catch(()=>{});throw e;}
  }finally{
    if(localImport===operation)localImport=null;
    if(operation.epoch!==null&&operation.epoch===generation){busy=false;experience.finish();status('モデル取り込み処理が終了しました。');}
    refreshLocal().catch(()=>{});
    controls();
  }
});
handle('load-model',async()=>{
  const cfg=aiOptions(),epoch=++generation;busy=true;experience.start('model-preload');controls();status('Gemma 4 E2Bを端末内で読み込み中…');
  try{const r=await nativeCall('loadModel',cfg,95000);if(epoch===generation){$('local-model-status').textContent=r.description;status('モデル読み込み完了。会話開始時には再利用します。');}}
  catch(e){if(epoch===generation){nativeCall('cancelAI',{},1000).catch(()=>{});throw e;}}
  finally{if(epoch===generation){busy=false;experience.finish();refreshLocal().catch(()=>{});controls();}}
});
handle('unload-model',async()=>{
  const epoch=++generation;busy=true;experience.start('model-unload');controls();status('モデルを解放しています…');
  try{await nativeCall('unloadModel',{},95000);if(epoch===generation){await refreshLocal();status('モデルをメモリから解放しました。');}}
  catch(e){if(epoch===generation){nativeCall('cancelAI',{},1000).catch(()=>{});throw e;}}
  finally{if(epoch===generation){busy=false;experience.finish();refreshLocal().catch(()=>{});controls();}}
});
addEventListener('morsetalk-local-import-start',()=>{
  if(!localImport||localImport.epoch!==null)return;
  localImport.epoch=++generation;busy=true;experience.start('model-import');controls();status('モデルを端末内に取り込み中…「すべて停止」で中断できます。');
});
addEventListener('morsetalk-local-model',()=>{refreshLocal().catch(()=>{});});
addEventListener('pagehide',()=>stop('画面を離れたため停止しました。'));
addEventListener('morsetalk-native-pause',()=>stop('画面を離れたため停止しました。'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(localTimer);localTimer=null;stop('画面が非表示になったため停止しました。');}else refreshLocal().catch(()=>{});});
addEventListener('morsetalk-native-resume',()=>{refreshLocal().catch(()=>{});});
aiCapabilities().then(c=>{
  if(c.portable){$('ai-help').textContent=c.description;return;}
  $('provider').value=c.provider;$('endpoint').value=c.endpoint;$('model').value=c.model||'';
  if(c.native){providerChanged();refreshLocal().catch(()=>{});$('ai-help').textContent='Gemma 4 E2BをLiteRT-LMで端末内実行します。モデルファイルは別途必要です。失敗してもクラウドや別モデルへ切り替えません。Ollama接続は明示的に選択できます。';}
  else {$('ai-help').textContent=c.remote?'外部HTTPSのAIが設定されています。会話文はこのAIへ送られます。':'同じPCのAIサーバーを使用する設定です。推論先もローカルか確認してください（Ollama: OLLAMA_NO_CLOUD=1）。URL変更はサーバー環境変数です。';}
  experience.refresh();
}).catch(e=>{$('ai-help').textContent=`${e.message} 単独HTMLの通信自己診断は利用できます。`;});
controls();
