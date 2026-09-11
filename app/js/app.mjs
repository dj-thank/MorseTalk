import {encodeText,decodeCode,normalizeCode,codeToSegments,synthesize,pcmToWav,durationOf,validateTiming} from '../core/morse.mjs';
import {newMessageId,prepareMessage,packFrame,unpackFrame,parseRoom} from '../core/packet.mjs';
import {ToneDetector} from '../core/dsp.mjs';
import {LinkSession} from '../core/link.mjs';
import {parseWav} from '../core/wav.mjs';
import {AudioEngine,to16kWav} from './audio.mjs';
import {hasNative,nativeCall,capabilities,transcribeWav,speak,stopSpeech,cancelNativeRecognition,setAwake} from './voice.mjs';
const $=id=>document.getElementById(id),audio=new AudioEngine();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const link=new LinkSession();
let state='idle',epoch=0,listenWanted=false,prepared=null,draftId=newMessageId(),ackTimer=null,recordTimer=null,record=null,fetchAbort=null;
let caps={platform:'browser',offlineSpeech:false},history=[],historySequence=0,currentTab='conversation';
const SETTINGS_KEY='morsetalk.settings.v1',HISTORY_KEY='morsetalk.history.v1';
const busy=()=>!['idle','listening'].includes(state);
function notice(message){$('notice').textContent=String(message);$('notice').hidden=false;}
function clearNotice(){$('notice').hidden=true;$('notice').textContent='';}
function explain(error){
  if(error?.name==='NotAllowedError')return 'マイクが許可されていません。アプリ / ブラウザのマイク権限を許可してから再試行してください。';
  if(error?.name==='NotFoundError')return 'マイクが見つかりません。端末に接続されているか確認してください。';
  if(error?.name==='NotReadableError')return 'マイクを開けません。他の録音・通話アプリを閉じてから再試行してください。';
  if(error?.name==='AbortError')return '操作をキャンセルしました。';
  return error?.message||String(error);
}
function config(){
  const mode=$('mode').value,wpm=Number($('wpm').value),frequency=Number($('frequency').value),volume=Number($('volume').value),room=$('room').value,threshold=Number($('threshold').value);
  validateTiming({wpm,frequency,volume});if(mode==='packet')parseRoom(room);
  return {mode,wpm,frequency,volume,room,threshold,language:$('language').value,requestAck:mode==='packet'&&$('ask-ack').checked};
}
function setState(value,label){
  state=value;$('status').textContent=label||({idle:'待機中',listening:'受信中 · 相手のモールス音を待っています',tx:'モールス音を送信中',recording:'話してください · 最大20秒',recognizing:'端末内で音声を文字にしています',speaking:'受信した言葉を読み上げています',processing:'処理しています',connecting:'マイクを準備しています',stopping:'停止しています'}[value]||value);
  $('status-light').classList.toggle('busy',value!=='idle');setAwake(value!=='idle');renderControls();
}
function renderControls(){
  const available=!busy()&&!link.pending;
  for(const el of document.querySelectorAll('[data-setting]'))el.disabled=state!=='idle'||!!link.pending;
  $('send').disabled=!available||!prepared;
  $('voice').disabled=!(state==='recording'||available&&caps.offlineSpeech);
  $('voice').textContent=state==='recording'?'■ 録音を終える':'◉ 声を文字に';
  $('listen').disabled=busy();
  $('listen').textContent=listenWanted?'■ マイク受信を停止':'◎ マイクで受信を開始';
  $('listen').classList.toggle('listening',listenWanted);
  $('receiver-prompt').textContent=state==='listening'?'相手のモールス音を待っています。':state==='tx'?'送信中は、マイクを止めています。':'相手が送る前に、受信を開始。';
  $('stop').disabled=state==='idle'&&!link.pending;
  for(const id of ['manual-speak','manual-send','dot','dash','letter-gap','word-gap','hold-key','manual-backspace','manual-clear'])$(id).disabled=state!=='idle';
  $('manual-mode').disabled=state!=='idle';$('manual-code').disabled=state!=='idle';
  $('import-audio').disabled=state!=='idle';
  $('export-wav').disabled=busy()||!prepared;$('copy-code').disabled=!prepared;
  $('draft').disabled=busy()||!!link.pending;
  for(const el of document.querySelectorAll('.history-speak'))el.disabled=busy()||!!link.pending;
  $('transmit-progress').hidden=state!=='tx';
}
function secondsText(s){const n=Math.ceil(s);return n<60?`${n}秒`:`${Math.floor(n/60)}分${n%60}秒`;}
function refreshPreview(){
  try{
    const cfg=config();$('room-field').hidden=cfg.mode!=='packet';$('ask-ack').disabled=cfg.mode!=='packet'||state!=='idle';
    $('volume-value').textContent=`${Math.round(cfg.volume*100)}%`;
    const text=$('draft').value,bytes=new TextEncoder().encode(text).length;
    $('byte-count').textContent=cfg.mode==='packet'?`${bytes} / 240 バイト`:`${[...text].length} 文字`;
    if(!text.trim()){prepared=null;$('estimate').textContent='送信時間を表示します';$('preview-code').textContent='· · ·';$('normalized').textContent='';$('byte-count').classList.remove('error');renderControls();return;}
    prepared=prepareMessage({...cfg,text,id:draftId});
    if(prepared.seconds>600)throw new Error('１回の送信が10分を超えます。文章を分けてください。');
    $('estimate').textContent=`送信 ${secondsText(prepared.seconds)}${cfg.requestAck?' ＋受信確認':''}`;
    $('normalized').textContent=cfg.mode==='packet'?'MT1独自形式 · UTF-8 / Base32 / CRC32。和文モールスとは異なります。':`送る文字：${prepared.normalized}`;
    $('preview-code').textContent=prepared.code;$('byte-count').classList.remove('error');
  }catch(error){prepared=null;$('estimate').textContent='入力を確認してください';$('byte-count').classList.add('error');$('preview-code').textContent='';$('normalized').textContent=explain(error);}
  renderControls();
}
function saveSettings(){
  try{const cfg=config();localStorage.setItem(SETTINGS_KEY,JSON.stringify({...cfg,autoSpeak:$('auto-speak').checked,replyAck:$('reply-ack').checked,saveHistory:$('save-history').checked}));}catch{}
}
function restoreSettings(){
  try{
    const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');if(!s||typeof s!=='object')return;
    if(['packet','international','wabun'].includes(s.mode))$('mode').value=s.mode;
    if(Number.isFinite(s.wpm)&&s.wpm>=8&&s.wpm<=60)$('wpm').value=s.wpm;
    if([500,600,700,800,1000].includes(s.frequency))$('frequency').value=s.frequency;
    if(typeof s.room==='string'&&/^\d{4}$/.test(s.room))$('room').value=s.room;
    if(Number.isFinite(s.volume)&&s.volume>=0.05&&s.volume<=0.6)$('volume').value=s.volume;
    if([0.006,0.012,0.03].includes(s.threshold))$('threshold').value=s.threshold;
    if(['ja-JP','en-US'].includes(s.language))$('language').value=s.language;
    for(const [key,id] of [['autoSpeak','auto-speak'],['replyAck','reply-ack'],['saveHistory','save-history'],['requestAck','ask-ack']])if(typeof s[key]==='boolean')$(id).checked=s[key];
    if($('save-history').checked){
      const saved=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');
      if(Array.isArray(saved))history=saved.filter(x=>x&&['in','out'].includes(x.direction)&&typeof x.text==='string'&&x.text.length<=4096&&typeof x.status==='string'&&x.status.length<200&&Number.isFinite(x.time)).slice(-50).map(x=>({...x,key:++historySequence}));
    }else localStorage.removeItem(HISTORY_KEY);
  }catch{}
}
function persistHistory(){try{if($('save-history').checked)localStorage.setItem(HISTORY_KEY,JSON.stringify(history.slice(-50)));else localStorage.removeItem(HISTORY_KEY);}catch{notice('端末への保存ができませんでした。会話はこの画面内だけに残ります。');}}
function renderHistory(){
  const target=$('history');target.replaceChildren();
  if(!history.length){const empty=document.createElement('div');empty.className='empty-state';const mark=document.createElement('span');mark.textContent='· ─ ·';const p=document.createElement('p');p.textContent='ここに、あなたと相手の言葉が並びます。';const small=document.createElement('small');small.textContent=$('save-history').checked?'この端末への保存が有効です。':'通常はこの画面を閉じると消えます。保存は設定で選べます。';empty.append(mark,p,small);target.append(empty);return;}
  for(const m of history){
    const b=document.createElement('article');b.className=`bubble ${m.direction==='out'?'outgoing':''}`;
    const head=document.createElement('div');head.className='bubble-head';const who=document.createElement('small');who.textContent=`${m.direction==='out'?'あなた':'受信'} · ${new Date(m.time).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}`;
    const replay=document.createElement('button');replay.className='text-button history-speak';replay.textContent='読み上げ';replay.setAttribute('aria-label',`${m.direction==='out'?'送信':'受信'}した文章を読み上げ`);replay.disabled=busy()||!!link.pending;replay.addEventListener('click',()=>readText(m.text,m.language||$('language').value));head.append(who,replay);
    const text=document.createElement('p');text.textContent=m.text;const status=document.createElement('small');status.textContent=m.status;b.append(head,text,status);target.append(b);
  }
  target.scrollTop=target.scrollHeight;
}
function addHistory(message){history.push({key:++historySequence,time:Date.now(),language:$('language').value,...message});history=history.slice(-50);renderHistory();persistHistory();return history.at(-1);}
function markDelivery(id,status){for(const m of history)if(m.direction==='out'&&m.id===id)m.status=status;renderHistory();persistHistory();}
async function startListening(e=epoch){
  if(e!==epoch||!listenWanted)return;
  endKey(true);let cfg;
  try{cfg=config();link.room=cfg.room;setState('connecting');
    await audio.startInput({wpm:cfg.wpm,frequency:cfg.frequency,mode:cfg.mode==='packet'?'international':cfg.mode,threshold:cfg.threshold},event=>{
      if(e!==epoch)return;
      if(event.kind==='level'){$('level').value=event.value.rms;$('tone-state').textContent=event.value.on?'検出中':'待受';$('receiver-symbol').classList.toggle('active',event.value.on);}
      else if(event.kind==='update')$('live-code').textContent=event.value;
      else if(event.kind==='message')receiveDecoded(event.value,{e,source:'microphone'}).catch(error=>{notice(explain(error));});
      else if(event.kind==='error'){notice(event.value);stopAll('マイクを停止しました。');}
    });
    if(e!==epoch){await audio.stopInput();return;}
    setState('listening',link.pending?'受信確認を待っています · 相手も同じ通信コードで受信してください':undefined);
  }catch(error){
    if(e!==epoch)return;listenWanted=false;setState('idle');if(error.name!=='AbortError')notice(explain(error));
  }
}
async function stopAll(label='停止しました。'){
  const e=++epoch;listenWanted=false;clearTimeout(ackTimer);clearTimeout(recordTimer);ackTimer=null;recordTimer=null;
  if(link.pending)markDelivery(link.pending.id,'受信確認を中止 · 到達は未確認');link.cancel();fetchAbort?.abort();fetchAbort=null;
  cancelNativeRecognition();stopSpeech();record=null;setState('stopping');
  await audio.stopAll();
  $('level').value=0;$('tone-state').textContent='待機';$('receiver-symbol').classList.remove('active');
  if(e===epoch)setState('idle',label);
}
async function playWire(wire,cfg){
  const segments=codeToSegments(encodeText(wire).code,cfg.wpm);
  return audio.play(segments,{...cfg,onProgress:p=>{$('progress').value=p;$('progress-label').textContent=`${Math.round(p*100)}% · 残り約${secondsText((1-p)*durationOf(segments))}`;}});
}
function armAckTimer(e,cfg){
  clearTimeout(ackTimer);if(!link.pending||e!==epoch)return;
  const ackWire=packFrame({type:'ack',room:cfg.room,id:link.pending.id});
  const timeout=durationOf(codeToSegments(encodeText(ackWire).code,cfg.wpm))*1000+8500;
  link.arm(timeout);
  ackTimer=setTimeout(async()=>{
    if(e!==epoch||!link.pending)return;
    const retry=link.retry(2);if(!retry)return;
    if(retry.failed){markDelivery(retry.id,'受信確認なし · 相手に届いたかは不明');notice('受信確認が届きませんでした。最大１回の再送を終了しました。相手の設定・受信状態を確認してください。');setState(state,'受信確認なし · 再送終了');return;}
    try{
      await audio.stopInput();if(e!==epoch)return;
      setState('tx','受信確認がないため再送しています（2/2）');markDelivery(retry.id,'再送中（2/2）');
      const ok=await playWire(retry.wire,cfg);if(!ok||e!==epoch)return;
      markDelivery(retry.id,'再送済み · 受信確認待ち');armAckTimer(e,cfg);await startListening(e);
    }catch(error){if(e===epoch){notice(explain(error));await stopAll('再送を停止しました。');}}
  },timeout+50);
}
async function sendDraft(){
  endKey(true);
  if(busy()||link.pending)return;
  refreshPreview();if(!prepared){notice($('normalized').textContent||'文章を入力してください。');return;}
  const cfg=config(),text=$('draft').value,id=draftId,job=prepareMessage({...cfg,text,id});
  const e=++epoch,resume=listenWanted||cfg.requestAck;clearNotice();
  try{
    setState('tx');await audio.stopInput();if(e!==epoch)return;
    link.room=cfg.room;
    if(cfg.mode==='packet')link.begin({id,text,requestAck:cfg.requestAck});
    addHistory({direction:'out',text:job.normalized,id,status:'送信中',mode:cfg.mode});
    const ok=await audio.play(job.segments,{...cfg,onProgress:p=>{$('progress').value=p;$('progress-label').textContent=`${Math.round(p*100)}% · 残り約${secondsText((1-p)*job.seconds)}`;}});
    if(e!==epoch||!ok){markDelivery(id,'送信を中断 · 到達は未確認');return;}
    markDelivery(id,cfg.requestAck?'送信済み · 受信確認待ち':'送出済み · 相手の受信は未確認');
    draftId=newMessageId();refreshPreview();listenWanted=resume;
    if(cfg.requestAck)armAckTimer(e,cfg);
    if(resume)await startListening(e);else setState('idle','送信終了 · 相手の画面で受信を確認してください');
  }catch(error){if(e===epoch){markDelivery(id,'送信に失敗 · 到達は未確認');notice(explain(error));await stopAll('送信を停止しました。');}}
}
async function receiveDecoded(value,{e=epoch,source='microphone'}={}){
  if(e!==epoch||source==='microphone'&&state!=='listening')return;
  const cfg=config();$('live-code').textContent=value.code;
  if(value.invalid){notice('符号の長さ・区切りを正しく判定できませんでした。読み上げずに破棄しました。速度・音量・距離を確認してください。');return;}
  let received;
  try{received=cfg.mode==='packet'?link.receive(value.text):{text:value.text,duplicate:false};}
  catch(error){notice(explain(error));return;}
  if(received.ignored)return;
  if(received.acknowledged){clearTimeout(ackTimer);ackTimer=null;markDelivery(received.id,'相手から受信確認が届きました（認証ではありません）');setState('listening','相手の受信確認が届きました · 続けて受信中');return;}
  if(!received.text?.trim())return;
  const shouldAck=source==='microphone'&&received.ack&&$('reply-ack').checked;
  const shouldSpeak=!received.duplicate&&$('auto-speak').checked;
  if(!received.duplicate)addHistory({direction:'in',text:received.text,id:received.id,mode:cfg.mode,status:cfg.mode==='packet'?`${source==='file'?'WAVから復元':'受信'} · CRC検証済み（相手の認証ではありません）`:'モールスを復号 · チェックサムなし'});
  if(!shouldAck&&!shouldSpeak)return;
  const pausedAck=!!link.pending;if(pausedAck)clearTimeout(ackTimer);
  setState('processing');await audio.stopInput();if(e!==epoch)return;
  try{
    if(shouldAck){await wait(1500);if(e!==epoch)return;setState('tx','受信確認をモールス音で返しています');const ok=await playWire(received.ack,cfg);if(!ok||e!==epoch)return;}
    if(shouldSpeak){setState('speaking');try{await speak(received.text,cfg.language);}catch(error){notice(explain(error));}}
  }finally{
    if(e===epoch){await wait(250);if(e!==epoch)return;if(pausedAck&&link.pending)armAckTimer(e,cfg);if(listenWanted)await startListening(e);else setState('idle','受信した文を会話に追加しました。');}
  }
}
async function readText(text,language=$('language').value){
  if(busy()||link.pending)return;endKey(true);const e=++epoch,resume=listenWanted;
  try{clearNotice();setState('speaking');await audio.stopInput();if(e!==epoch)return;await speak(text,language);}
  catch(error){if(e===epoch)notice(explain(error));}
  finally{if(e===epoch){await wait(250);if(e===epoch){listenWanted=resume;if(resume)await startListening(e);else setState('idle');}}}
}
async function voiceInput(){
  endKey(true);
  if(state==='recording'){await finishRecording();return;}
  if(busy()||link.pending||!caps.offlineSpeech)return;
  const e=++epoch,resume=listenWanted,cfg=config();clearNotice();
  try{
    setState('recognizing',hasNative()?'話してください · 端末内で認識します':'録音の準備中');await audio.stopInput();if(e!==epoch)return;
    if(hasNative()){
      const result=await nativeCall('recognize',{language:cfg.language},35000);if(e!==epoch)return;
      if(!result?.text?.trim())throw new Error('音声を認識できませんでした。');
      $('draft').value=result.text;draftId=newMessageId();refreshPreview();
      listenWanted=resume;if(resume)await startListening(e);else setState('idle','認識した文章を確認してから送信してください。');
    }else{
      record={chunks:[],samples:0,e,resume,cfg,rate:0,finishing:false};setState('recording');
      const info=await audio.startInput({record:true},event=>{
        const r=record;if(!r||r.e!==e||e!==epoch)return;
        if(event.kind==='pcm'){r.chunks.push(event.value);r.samples+=event.value.length;if(r.rate&&r.samples>=r.rate*20&&!r.finishing)finishRecording();}
        else if(event.kind==='error'){notice(event.value);stopAll();}
      });
      if(!record||e!==epoch)return;record.rate=info.sampleRate;
      recordTimer=setTimeout(()=>finishRecording(),20000);
    }
  }catch(error){if(e===epoch){notice(explain(error));record=null;listenWanted=resume;if(resume)await startListening(e);else setState('idle');}}
}
async function finishRecording(){
  const r=record;if(!r||r.finishing)return;r.finishing=true;clearTimeout(recordTimer);recordTimer=null;setState('recognizing');
  try{
    await audio.stopInput();if(r.e!==epoch)return;
    const wav=to16kWav(r.chunks,r.rate);record=null;fetchAbort=new AbortController();
    const timeout=setTimeout(()=>fetchAbort?.abort(),45000);
    let text;try{text=await transcribeWav(wav,r.cfg.language,fetchAbort.signal);}finally{clearTimeout(timeout);fetchAbort=null;}
    if(r.e!==epoch)return;$('draft').value=text;draftId=newMessageId();refreshPreview();
  }catch(error){if(r.e===epoch)notice(explain(error));}
  finally{record=null;if(r.e===epoch){listenWanted=r.resume;if(r.resume)await startListening(r.e);else setState('idle','認識結果を確認してから送信してください。');}}
}
async function saveBlob(blob,filename){
  if(hasNative()){
    if(blob.size>20*1024*1024)throw new Error('保存するファイルは20 MBまでです。');
    const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return nativeCall('saveFile',{filename,mime:blob.type||'application/octet-stream',base64:btoa(binary)},180000);
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
async function exportWav(){
  try{const cfg=config();const job=prepareMessage({...cfg,text:$('draft').value,id:draftId,requestAck:false});if(job.seconds>300)throw new Error('WAV保存は5分以内の文章にしてください。');const pcm=synthesize(job.segments,{...cfg,sampleRate:16000,maxSeconds:300});await saveBlob(new Blob([pcmToWav(pcm)],{type:'audio/wav'}),'MorseTalk-message.wav');}
  catch(error){notice(explain(error));}
}
async function importAudio(event){
  const file=event.target.files?.[0];event.target.value='';if(!file||state!=='idle')return;
  const e=++epoch;clearNotice();setState('processing','WAVのモールス音を解析しています');
  try{
    if(file.size>20*1024*1024)throw new Error('WAVは20 MB以下にしてください。');
    const {pcm,sampleRate}=parseWav(await file.arrayBuffer());if(e!==epoch)return;
    const cfg=config(),results=[];link.room=cfg.room;
    const detector=new ToneDetector({...cfg,sampleRate,mode:cfg.mode==='packet'?'international':cfg.mode,onMessage:x=>results.push(x)});
    for(let pos=0;pos<pcm.length;pos+=32768){if(e!==epoch)return;detector.push(pcm.subarray(pos,pos+32768));if(pos%262144===0)await wait(0);}
    detector.push(new Float32Array(Math.ceil(sampleRate*Math.max(1.2,20*1.2/cfg.wpm))));detector.flush();
    if(!results.length)throw new Error('モールス信号を検出できませんでした。WAV・方式・速度・周波数を確認してください。');
    for(const result of results){if(e!==epoch)return;await receiveDecoded(result,{e,source:'file'});}
  }catch(error){if(e===epoch)notice(explain(error));}
  finally{if(e===epoch)setState('idle','WAVの解析を終了しました。');}
}
function refreshManual(){
  try{const result=decodeCode($('manual-code').value,$('manual-mode').value);$('manual-text').textContent=result.text||'…';$('manual-text').dataset.valid=result.text?'true':'false';}
  catch(error){$('manual-text').textContent=explain(error);$('manual-text').dataset.valid='false';}
}
function addManual(token){if(state!=='idle')return;const s=$('manual-code').value;if(s.length+token.length>4096)return;$('manual-code').value=s+token;refreshManual();}
let keyStart=0,keyPreviousEnd=0,keyPointer=null;
async function keyDown(event){
  if(state!=='idle'||keyStart)return;
  if(event.type==='keydown'&&(![' ','Enter'].includes(event.key)||event.repeat))return;
  event.preventDefault();keyStart=performance.now();
  if(event.pointerId!==undefined){keyPointer=event.pointerId;try{$('hold-key').setPointerCapture(event.pointerId);}catch{}}
  const gap=keyPreviousEnd?keyStart-keyPreviousEnd:0,unit=1200/config().wpm;
  if($('manual-code').value&&!/[ /]$/.test($('manual-code').value)){if(gap>=5*unit)addManual(' / ');else if(gap>=2*unit)addManual(' ');}
  $('hold-key').classList.add('pressed');try{await audio.keyDown(config());}catch(error){notice(explain(error));endKey(true);}
}
function endKey(cancel=false){
  if(!keyStart){audio.keyUp();return;}
  const duration=performance.now()-keyStart;keyStart=0;keyPreviousEnd=performance.now();audio.keyUp();$('hold-key').classList.remove('pressed');
  if(keyPointer!==null){try{$('hold-key').releasePointerCapture(keyPointer);}catch{}keyPointer=null;}
  if(!cancel){const unit=1200/config().wpm;if(duration<unit*0.25)notice('押す時間が短すぎます。点・線ボタンでも入力できます。');else if(duration>unit*10)notice('長押しが長すぎたため、符号に追加しませんでした。');else addManual(duration<unit*2?'.':'-');}
}
async function playManual(){
  if(state!=='idle')return;endKey(true);const e=++epoch;
  try{
    const code=normalizeCode($('manual-code').value),result=decodeCode(code,$('manual-mode').value);if(!result.text)throw new Error('符号を入力してください。');
    clearNotice();setState('tx');const cfg=config(),segments=codeToSegments(code,cfg.wpm);
    const completed=await audio.play(segments,{...cfg,onProgress:p=>{$('progress').value=p;$('progress-label').textContent=`${Math.round(p*100)}%`;}});
    if(e===epoch&&completed)addHistory({direction:'out',text:result.text,status:'手入力のモールスを送出 · 到達は未確認',mode:$('manual-mode').value});
  }catch(error){if(e===epoch)notice(explain(error));}
  finally{if(e===epoch)setState('idle');}
}
function selfTest(){
  try{
    const wire=packFrame({text:'こんにちは🙂',room:'1234',id:42}),pcm=synthesize(codeToSegments(encodeText(wire).code,40),{sampleRate:16000});let result=null;
    const detector=new ToneDetector({sampleRate:16000,wpm:40,onMessage:x=>result=x});detector.push(pcm);
    if(!result||unpackFrame(result.text).text!=='こんにちは🙂')throw new Error('PCMの往復が一致しません。');
    $('self-test-result').textContent='成功：日本語 → UTF-8 → モールス → PCM音声 → 復号 → CRC検証 → 元の日本語が一致しました。実機の音響経路は未検査です。';
  }catch(error){$('self-test-result').textContent=`失敗：${explain(error)}`;}
}
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
  endKey(true);currentTab=button.dataset.tab;
  for(const tab of document.querySelectorAll('[data-tab]')){const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));}
  for(const id of ['conversation','manual','guide'])$(`panel-${id}`).hidden=id!==currentTab;
});
$('draft').addEventListener('input',()=>{draftId=newMessageId();refreshPreview();});
for(const el of document.querySelectorAll('[data-setting]'))el.addEventListener('change',()=>{if(el.id==='mode'){$('wpm').value=el.value==='packet'?40:18;link.cancel();}saveSettings();refreshPreview();});
for(const id of ['auto-speak','reply-ack','save-history'])$(id).addEventListener('change',()=>{saveSettings();if(id==='save-history'){persistHistory();renderHistory();}});
$('volume').addEventListener('input',refreshPreview);
$('send').addEventListener('click',()=>sendDraft().catch(error=>notice(explain(error))));
$('voice').addEventListener('click',()=>voiceInput().catch(error=>notice(explain(error))));
$('listen').addEventListener('click',async()=>{if(listenWanted)await stopAll('マイク受信を停止しました。');else{clearNotice();listenWanted=true;const e=++epoch;await startListening(e);}});
$('stop').addEventListener('click',()=>{endKey(true);stopAll();});
$('export-wav').addEventListener('click',exportWav);
$('copy-code').addEventListener('click',async()=>{try{if(prepared){await navigator.clipboard.writeText(prepared.code);notice('モールス符号をコピーしました。');}}catch{notice('コピーできませんでした。符号の欄を選択してコピーしてください。');}});
$('import-audio').addEventListener('change',importAudio);
$('clear-history').addEventListener('click',()=>{if(confirm('この端末の会話履歴を消去しますか？')){history=[];persistHistory();renderHistory();}});
$('export-history').addEventListener('click',()=>saveBlob(new Blob([JSON.stringify({format:'MorseTalk-history-v1',exportedAt:new Date().toISOString(),messages:history},null,2)],{type:'application/json'}),'MorseTalk-conversation.json').catch(error=>notice(explain(error))));
$('manual-code').addEventListener('input',refreshManual);$('manual-mode').addEventListener('change',refreshManual);
$('dot').addEventListener('click',()=>addManual('.'));$('dash').addEventListener('click',()=>addManual('-'));$('letter-gap').addEventListener('click',()=>addManual(' '));$('word-gap').addEventListener('click',()=>addManual(' / '));
$('manual-backspace').addEventListener('click',()=>{$('manual-code').value=$('manual-code').value.slice(0,-1);refreshManual();});
$('manual-clear').addEventListener('click',()=>{$('manual-code').value='';keyPreviousEnd=0;refreshManual();});
$('manual-speak').addEventListener('click',()=>{if($('manual-text').dataset.valid==='true')readText($('manual-text').textContent,$('manual-mode').value==='international'?'en-US':$('language').value);else notice('正しい符号を入力してください。');});
$('manual-send').addEventListener('click',playManual);
$('hold-key').addEventListener('pointerdown',keyDown);$('hold-key').addEventListener('pointerup',()=>endKey());$('hold-key').addEventListener('pointercancel',()=>endKey(true));$('hold-key').addEventListener('lostpointercapture',()=>{if(keyStart)endKey(true);});
$('hold-key').addEventListener('keydown',keyDown);$('hold-key').addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();endKey();}});$('hold-key').addEventListener('blur',()=>endKey(true));
$('self-test').addEventListener('click',selfTest);
const background=()=>{endKey(true);if(state!=='idle'||link.pending)stopAll('画面が非表示になったため停止しました。再開は手動で行ってください。');};
addEventListener('pagehide',background);addEventListener('morsetalk-native-pause',background);document.addEventListener('visibilitychange',()=>{if(document.hidden)background();});
addEventListener('error',event=>{notice(`画面の処理でエラーが発生しました：${event.message}`);audio.stopAll();});
addEventListener('unhandledrejection',event=>{notice(explain(event.reason));});
restoreSettings();link.room=$('room').value;refreshPreview();refreshManual();renderHistory();setState('idle');
capabilities().then(value=>{caps=value;$('platform-label').textContent=caps.platform==='android'?'Android · 端末内':caps.platform==='windows'?'Windows · 端末内':'ブラウザ · 端末内';$('voice-capabilities').textContent=caps.description|| (caps.offlineSpeech?'オフライン音声認識を利用できます。':'オフライン音声認識は、この端末では利用できません。');$('voice').title=caps.description||'';renderControls();}).catch(error=>{$('voice-capabilities').textContent=explain(error);renderControls();});
