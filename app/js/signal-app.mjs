import {FastAudio} from './fast-audio.mjs';
import {ReliableMorseLink,MorseAgent} from '../core/fast-link.mjs';
import {unpackFastFrame} from '../core/fast-codec.mjs';
import {kanaToWire,packPhonetic,phoneticPcm} from '../core/phonetic-morse.mjs';
import {discussionPrompt,parseDiscussion} from '../core/discussion.mjs';
import {InlineMessage} from '/monitor/inline-message.mjs';
import {AckMessage} from '/monitor/ack-message.mjs';
import {nativeCall,setAwake} from './voice.mjs';
import {encodeText,codeToSegments,durationOf} from '../core/morse.mjs';
const $=id=>document.getElementById(id),messages=[0,1].map(i=>new InlineMessage($('message-'+i)));
const acknowledgements=[0,1].map(i=>new AckMessage($('message-'+i)));let txKind=null,rxKind=null,txAttempt=0;
const ackPayload=kanaToWire('じゅしんしました');
const settings=['role','speed','volume','topic'];
for(const id of settings){try{const value=localStorage.getItem('signal-'+id);if(value!==null)$(id).value=value;}catch{}}
let audio,link,agent,rpc,role=0,epoch=0,rid=0,rxSeq=null;const pending=new Map(),readings=new Map(),events=[],logRows=new Map();
const colors=['#f5b942','#5fe0b0'];let bars=[];
function phase(i,text){$('phase-'+i).textContent=text;}
function event(e){const detail={t:Date.now(),role,...e};if(!['mark','level'].includes(e.kind)){events.push(detail);if(events.length>1000)events.shift();}if(e.kind==='transmit')txAttempt=e.attempt;if(e.kind==='generated'){messages[role].waiting('送信を準備しています…');$('delivery-'+role).textContent='送信準備';}if(e.kind==='stopped'){acknowledgements.forEach(a=>a.interrupt());for(const message of messages)if(message.element.classList.contains('waiting'))message.waiting('会話を停止しました');}window.dispatchEvent(new CustomEvent('morsetalk-signal-event',{detail}));}
// Debug readback contains actual events only; never injects peer text or PCM.
globalThis.morsetalkSignalSnapshot=()=>({events:[...events],active:!!agent?.active,role});
function mark(sender,on,units){if(!on)return;bars.push({t:performance.now(),sender,units});if(bars.length>100)bars.shift();const kind=sender===role?txKind:rxKind;$('channel').textContent=`${sender?'B':'A'} · ${kind==='ack'?'受信確認（ACK）':kind==='checksum'?'検査信号':kind==='data'?'メッセージ':'受信信号'} · ${units>=2?'─':'·'}`;}
function draw(){const canvas=$('strip'),ctx=canvas.getContext('2d'),w=canvas.width=canvas.clientWidth,h=canvas.height=80;ctx.clearRect(0,0,w,h);const now=performance.now();for(const b of bars){const x=w-(now-b.t)*.09;if(x<0)continue;ctx.fillStyle=colors[b.sender];ctx.fillRect(x,b.sender?48:12,Math.max(3,b.units*5),15);}requestAnimationFrame(draw);}draw();
function append(sender,text,seq){const key=`${epoch}:${sender}:${seq}`;let p=logRows.get(key);if(!p){p=document.createElement('p');logRows.set(key,p);$('log').append(p);}p.textContent=`${sender?'B':'A'} · ${text}`;while(logRows.size>60){const first=logRows.keys().next().value;logRows.get(first).remove();logRows.delete(first);}}
function stop(error){++epoch;agent?.stop();agent=null;link?.close();link=null;audio?.stop();audio=null;rpc?.close();rpc=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('停止'));}pending.clear();nativeCall('cancelAI',{},1000).catch(()=>{});setAwake(false);$('state').textContent='停止';$('listen').disabled=false;$('start').disabled=true;$('stop').disabled=true;for(const id of ['role','speed','topic'])$(id).disabled=false;if($('phase-'+role).textContent==='推論中')$('thought-'+role).textContent='返答の生成を停止しました';phase(role,'停止');phase(1-role,'受信終了');for(const i of [0,1]){if(/^(送信中|受信中)$/.test($('delivery-'+i).textContent))$('delivery-'+i).textContent='停止';}if(error){$('error').hidden=false;$('error').textContent=error.message||String(error);}event({kind:'stopped',error:error?.message});}
async function reading(text,mode='reading'){if(typeof text!=='string'||!text.trim()||text.length>600)throw Error('AIの返答に変換できる本文がありません');const id=String(++rid);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('PCの読み変換に接続できません'));},6000);pending.set(id,{resolve,reject,timer});rpc.send(JSON.stringify({id,text,mode}));});}
async function listen(){const generation=++epoch;try{
  role=Number($('role').value);const wpm=Number($('speed').value);if(!Number.isFinite(wpm)||wpm<=0)throw Error('WPMは正の数値を入力してください');
  for(const id of settings){try{localStorage.setItem('signal-'+id,$(id).value);}catch{}}
  $('error').hidden=true;readings.clear();events.length=0;rxSeq=null;messages.forEach(m=>m.reset());bars=[];$('channel').textContent='待機';for(const i of [0,1]){$('delivery-'+i).textContent='待機';phase(i,'待機');}
  txKind=null;rxKind=null;acknowledgements.forEach(a=>a.hide());
  for(const i of [0,1]){$('lane-'+i).dataset.self=String(i===role);$('thought-'+i).textContent=i===role?'入力を待っています':'相手の推論は取得しません';}
  rpc=new WebSocket('ws://127.0.0.1:18790/reading');await new Promise((resolve,reject)=>{rpc.onopen=resolve;rpc.onerror=()=>reject(Error('PC接続を確認してください'));});
  rpc.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);m.result.error?p.reject(Error('読み変換に失敗しました')):p.resolve(m.result);};
  rpc.onclose=()=>{if(generation===epoch)stop(Error('PC接続が切れました'));};
  const options={wpm,volume:Number($('volume').value)*.008,frequency:1800,sampleRate:48000,acoustic:true,adaptive:true,threshold:.004};
  audio=new FastAudio({...options,phonetic:true,workletURL:new URL('./phonetic-worklet.mjs',import.meta.url).href,pcmFactory:(wire,opts)=>phoneticPcm(wire,opts)});
  const ackMs=phoneticPcm(packPhonetic({sender:role,seq:1,type:'ack',wire:ackPayload.wire}),options).seconds*1000;
  link=new ReliableMorseLink({room:'0000',session:20260912,sender:role,continuous:true,ackDelayMs:300,ackTimeoutMs:Math.min(180000,Math.ceil(ackMs+12000)),onEvent:e=>{if(generation!==epoch)return;event(e);if(e.kind==='delivered'){$('delivery-'+role).textContent='✓ 届きました';phase(role,'返答待ち');if(rxSeq!==e.seq%65534+1){messages[1-role].waiting();$('delivery-'+(1-role)).textContent='返答待ち';}}if(e.kind==='error')stop(Error(e.message));},sendAudio:async bytes=>{
    const frame=unpackFastFrame(bytes),payload=frame.type==='data'?readings.get(frame.text):ackPayload;if(!payload)throw Error('送信する読みがありません');const wire=packPhonetic({...frame,wire:payload.wire});
    txKind=frame.type;if(frame.type==='ack'){acknowledgements[role].outgoing(role,frame.seq,'受信しました');append(role,'受信しました',`ack-${frame.seq}`);}else acknowledgements[role].hide();
    phase(role,frame.type==='ack'?'受信確認':txAttempt?'再送中':'送信中');if(frame.type==='data'){messages[role].plain(frame.text);$('delivery-'+role).textContent=txAttempt?`再送 ${txAttempt} 回目`:'送信中';append(role,frame.text,frame.seq);}event({kind:'tx',seq:frame.seq,type:frame.type,text:frame.type==='ack'?payload.text:frame.text,wire:payload.wire,kana:payload.text});
    const segments=phoneticPcm(wire,options).segments;
    const baseSegments=codeToSegments(encodeText(wire).code,wpm,{experimental:true}),prefixSegments=codeToSegments(encodeText(wire.split(' / ')[0]).code,wpm,{experimental:true});
    const checksumAt=durationOf(segments)-durationOf(baseSegments)+durationOf(prefixSegments.slice(0,-1));
    let elapsed=0;const timers=[];for(const segment of segments){const at=elapsed;if(segment.on)timers.push(setTimeout(()=>{if(generation===epoch){txKind=frame.type==='ack'?'ack':at/1000>=checksumAt?'checksum':'data';mark(role,true,segment.seconds/(1.2/wpm));}},at));elapsed+=segment.seconds*1000;}
    try{await audio.transmit(wire);if(generation===epoch&&frame.type==='ack')acknowledgements[role].begin(role,frame.seq,'sent');}finally{timers.forEach(clearTimeout);if(generation===epoch){txKind=null;rxKind=null;}}
  }});
  class Agent extends MorseAgent{systemPrompt(){return discussionPrompt({role,topic:$('topic').value,turn:this.currentSeq})+'\n音響会話では短く話します。replyは8〜14文字程度の一文にし、読みは24文字以内を目指してください。一度に一つの要点だけを言います。';}}
  agent=new Agent({link,maxTurns:0,maxReplyBytes:132,onEvent:e=>{if(generation!==epoch)return;event(e);if(e.kind==='thinking'){messages[role].waiting('返答を考えています…');$('delivery-'+role).textContent='推論中';phase(role,'推論中');$('thought-'+role).textContent='受け取った内容から返答を構成中…';}if(e.kind==='error')stop(Error(e.message));},generate:async(messagesIn,{signal})=>{
    const result=await nativeCall('aiChat',{provider:'compatible',endpoint:'http://127.0.0.1:1234/v1/chat/completions',model:'gemma-4-e2b-it',consent:true,maxTokens:384,structuredDiscussion:true,messages:messagesIn},95000);if(signal.aborted||generation!==epoch)throw Error('停止');
    const raw=result.text,proposal=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||'{}'),r=await reading(proposal.reply),data=parseDiscussion(raw,'ja',r.reading);readings.set(data.reply,data.phonetic);while(readings.size>16)readings.delete(readings.keys().next().value);
    $('thought-'+role).textContent=`理解 · ${data.understanding}\n着眼点 · ${data.focus}`;event({kind:'awareness',understanding:data.understanding,focus:data.focus,input:messagesIn.at(-1).content});return data.reply;
  }});
  await audio.start(e=>{if(generation!==epoch)return;
    if(e.kind==='header'&&e.sender===1-role){if(e.type==='ack'&&e.seq===link.pending?.seq){rxKind='ack';acknowledgements[e.sender].begin(e.sender,e.seq,'receiving');phase(role,'受信確認を読取中');phase(e.sender,'ACK送信中');}else if(e.type==='data'&&e.seq===link.nextReceive){rxKind=e.stage==='checksum'?'checksum':'data';acknowledgements[e.sender].hide();}}
    if(e.kind==='level'){if(!audio.lastLevel||performance.now()-audio.lastLevel>200){audio.lastLevel=performance.now();event(e);}}
    if(e.kind==='mark'){mark(1-role,e.on,e.units);event(e);}
    if(e.kind==='character'&&e.type==='ack'&&e.sender!==role&&e.seq===link.pending?.seq){event({kind:'ack-character',sender:e.sender,seq:e.seq,wire:e.wire,text:e.text});acknowledgements[e.sender].progress(e.sender,e.seq,e.wire,{boundary:e.boundary});}
    if(e.kind==='character'&&e.type!=='ack'&&e.sender!==role&&e.seq===link.nextReceive&&!link.incoming.has(e.seq)){if(rxSeq!==e.seq){rxSeq=e.seq;messages[e.sender].reset();}phase(e.sender,'送信中');phase(role,'受信中');$('delivery-'+e.sender).textContent='受信中';messages[e.sender].update(e.wire,{boundary:e.boundary});}
    if(e.kind==='frame'){const f={...e.frame,room:'0000',session:20260912};event({kind:'rx',frame:f});if(f.sender===role)return;
      if(f.type==='ack'&&f.seq===link.pending?.seq){acknowledgements[f.sender].progress(f.sender,f.seq,f.wire,{final:true,state:'received'});append(f.sender,f.text,`ack-${f.seq}`);if(f.text)reading(f.text,'format').then(r=>{if(generation===epoch){acknowledgements[f.sender].format(f.sender,f.seq,f.wire,r.display);append(f.sender,r.display,`ack-${f.seq}`);}}).catch(()=>{});}rxKind=null;
      if(f.type==='data'&&f.seq===link.nextReceive&&!link.incoming.has(f.seq)){rxSeq=f.seq;messages[f.sender].update(f.wire,{final:true,animate:false});$('delivery-'+f.sender).textContent='✓ 受信';phase(f.sender,'送信完了');append(f.sender,f.text,f.seq);reading(f.text,'format').then(r=>{if(generation===epoch&&rxSeq===f.seq){messages[f.sender].format(r.display,{wire:f.wire});append(f.sender,r.display,f.seq);}}).catch(()=>{});}
      link.receive(f.type==='ack'?{...f,text:''}:f).catch(error=>{if(generation===epoch)stop(error);});
    }
    if(e.kind==='invalid'){event(e);if(!e.candidate&&/[AB]\d+[=+]/.test(e.rawText||''))$('channel').textContent='信号を読み取れません';}
    if(e.kind==='fatal')stop(Error(e.message));
  });
  if(generation!==epoch)return;setAwake(true);$('state').textContent='マイク受信中';phase(role,'受信待機');$('listen').disabled=true;$('stop').disabled=false;$('start').disabled=role!==0;for(const id of ['role','speed','topic'])$(id).disabled=true;event({kind:'ready',wpm,sampleRate:audio.ctx.sampleRate});
}catch(error){stop(error);}}
$('listen').onclick=listen;$('stop').onclick=()=>stop();$('start').onclick=()=>{$('start').disabled=true;agent.start($('topic').value).catch(error=>stop(error));};
$('volume').oninput=()=>{if(audio)audio.options.volume=Number($('volume').value)*.008;};
window.addEventListener('morsetalk-native-pause',()=>stop());window.addEventListener('pagehide',()=>stop());
function previewRole(){role=Number($('role').value);for(const i of [0,1]){$('lane-'+i).dataset.self=String(i===role);$('thought-'+i).textContent=i===role?'入力を待っています':'相手の推論は取得しません';}}
$('role').onchange=previewRole;previewRole();
