/* MorseTalk Signal Monitor. Renders what the endpoints report while they decode:
 * dit/dah timing → International Morse letter → Base32 → bytes → LZ → UTF-8 → CRC.
 * External endpoints are observed; the Start button owns a separate local PCM session. Optional readings/guesses come from a local Gemma 4 E2B. */
import { packFastFrame, fastWire, fastSegments, parseFastWire, unpackFastFrame } from '../app/core/fast-codec.mjs';
import { InlineMessage } from './inline-message.mjs';
import { AckMessage, ackText } from './ack-message.mjs';
import { SignalConversation } from './conversation.js';
import { SignalAudio } from './signal-audio.mjs';
import { INTERNATIONAL } from '../app/core/morse.mjs';

const $=id=>document.getElementById(id);
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MORSE_REVERSE=new Map(Object.entries(INTERNATIONAL).map(([k,v])=>[v,k]));
const STEPS=['mark','letter','byte','header','text','crc'];
const hex=b=>b.toString(16).padStart(2,'0').toUpperCase();

/* ---------- kana → romaji (built-in fallback, instant per-character staging) ---------- */
const KANA={あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',を:'o',ん:'n',が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゃ:'ya',ゅ:'yu',ょ:'yo',っ:'*',ー:'-','、':',','。':'.','！':'!','？':'?','　':' '};
const DIGRAPH={きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',にゃ:'nya',にゅ:'nyu',にょ:'nyo',ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',じゃ:'ja',じゅ:'ju',じょ:'jo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',てぃ:'ti',でぃ:'di',ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',うぃ:'wi',うぇ:'we',うぉ:'wo',ゔ:'vu'};
const toHira=s=>s.replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
const isKana=c=>/[ぁ-ゖァ-ヶー]/.test(c);
function kanaToRomaji(text){
  const h=toHira(text);let out='',i=0,pendingTsu=false;
  while(i<h.length){
    const two=h.slice(i,i+2);
    let r;
    if(DIGRAPH[two]){r=DIGRAPH[two];i+=2;}
    else{const c=h[i];r=KANA[c]??(isKana(c)?'?':c);i++;}
    if(r==='*'){pendingTsu=true;continue;}
    if(r==='-'){out+=out.slice(-1)||'-';continue;}
    if(pendingTsu){out+=r[0];pendingTsu=false;}
    out+=r;
  }
  return out;
}
const nbsp=c=>c===' '?' ':c;
const romajiHint=c=>c===' '?' ':isKana(c)?kanaToRomaji(c):/[A-Za-z0-9]/.test(c)?c:'□';

/* ---------- progressive MT2 decoding of a Base32 prefix ---------- */
function b32ToBytes(letters){
  const out=[];let value=0,bits=0;
  for(const c of letters){const v=ALPHABET.indexOf(c);if(v<0)break;value=(value<<5)|v;bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255);value&=(1<<bits)-1;}}
  return out;
}
function parseHeader(bytes){
  if(bytes.length<16)return null;
  const v=new DataView(Uint8Array.from(bytes.slice(0,16)).buffer);
  return {magic:bytes[0]===0x4d&&bytes[1]===0x32?'M2':'不正',ack:Boolean(bytes[2]&1),packed:Boolean(bytes[2]&4),room:String(v.getUint16(3)).padStart(4,'0'),session:v.getUint32(5).toString(16).toUpperCase().padStart(8,'0'),sender:bytes[9],seq:v.getUint16(10),len:v.getUint16(12),raw:v.getUint16(14)};
}
function lzPrefix(input,expected){
  const out=[];let p=0;
  while(p<input.length&&out.length<expected){
    const flags=input[p++];
    for(let bit=0;bit<8&&out.length<expected;bit++){
      if(p>=input.length)return out;
      if(flags&(1<<bit)){if(p+1>=input.length)return out;const t=(input[p++]<<8)|input[p++],d=(t>>>4)+1,n=(t&15)+3;if(d>out.length)return out;for(let j=0;j<n&&out.length<expected;j++)out.push(out[out.length-d]);}
      else out.push(input[p++]);
    }
  }
  return out;
}
const utf8Prefix=bytes=>new TextDecoder('utf-8').decode(Uint8Array.from(bytes),{stream:true});
function decodePrefix(letters){
  const bytes=b32ToBytes(letters),header=parseHeader(bytes);
  if(!header)return {bytes,header:null,payload:[],text:'',complete:false};
  const total=20+header.len,payload=bytes.slice(16,Math.min(16+header.len,bytes.length));
  const raw=header.packed?lzPrefix(payload,header.raw):payload;
  return {bytes,header,payload,text:header.ack?'':utf8Prefix(raw),complete:bytes.length>=total,total};
}

/* ---------- timeline strip ---------- */
const strip={canvas:$('strip'),blocks:[],unitMs:20};
function stripPush(role,start,end,kind){strip.blocks.push({role,start,end,kind});if(strip.blocks.length>4000)strip.blocks.splice(0,1000);}
function drawStrip(){
  const c=strip.canvas,ctx=c.getContext('2d'),dpr=window.devicePixelRatio||1,W=c.clientWidth,H=c.clientHeight;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const now=performance.now(),pxPerMs=Math.min(7,Math.max(.08,7/(strip.visualUnit||strip.unitMs))),span=W/pxPerMs;
  ctx.strokeStyle='rgba(255,255,255,.05)';ctx.lineWidth=1;
  const tick=strip.unitMs*10;for(let t=now-(now%tick);t>now-span;t-=tick){const x=W-(now-t)*pxPerMs;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  ctx.font='10px ui-monospace,monospace';ctx.fillStyle='rgba(139,154,176,.6)';ctx.fillText('A',8,22);ctx.fillText('B',8,H-14);
  ctx.strokeStyle='rgba(255,255,255,.08)';ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();
  for(const b of strip.blocks){
    const x1=W-(now-b.start)*pxPerMs,x2=W-(now-b.end)*pxPerMs;if(x2<0)continue;
    const y=b.role?H/2+14:14,h=H/2-28,color=b.role?'#5fe0b0':'#f5b942';
    ctx.fillStyle=b.kind==='bad'?'#ff7b72':color;ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=b.kind==='bad'?4:12;
    const w=Math.max(2,x2-x1);ctx.beginPath();ctx.roundRect(x1,y,w,h,3);ctx.fill();ctx.shadowBlur=0;
  }
  ctx.fillStyle='rgba(255,255,255,.35)';ctx.fillRect(W-1,0,1,H);
  requestAnimationFrame(drawStrip);
}
requestAnimationFrame(drawStrip);

/* ---------- lanes ---------- */
const lanes=[0,1].map(role=>({role,letters:'',acquired:false,text:'',dir:'idle',marks:0,e2bText:'',e2bTimer:null,lampTimer:null,anim:null,txAt:0,meta:null}));
const el=(role,name)=>$(`${name}-${role}`);
const inlineMessages=[0,1].map(role=>new InlineMessage($(`message-${role}`)));
const acknowledgements=[0,1].map(role=>new AckMessage($(`message-${role}`)));
let receiver=1,sharedSeq=null,revealEpoch=0,revealTimers=[],sharedReady='',sharedRevealed='';
function cancelReveal(){revealEpoch++;for(const t of revealTimers)clearTimeout(t);revealTimers=[];sharedReady='';sharedRevealed='';}
function beginReceive(sender,seq){
  receiver=1-sender;sharedSeq=seq;cancelReveal();resetLane(receiver);lanes[receiver].lastWire=null;
  document.querySelector('.shared-decoder').dataset.role=String(receiver);
  $('decode-heading').textContent=`${sender?'B':'A'} → ${receiver?'B':'A'}`;
  $('decode-stage').textContent='信号を受信中';$('decode-code').textContent='';$('decode-letter').textContent='—';$('decode-progress').textContent='0';$('decode-letters').replaceChildren();$('decode-output').textContent='';$('decode-output').dataset.text='';$('decode-kana').textContent='—';$('decode-check').textContent='受信中';$('decode-bytes').textContent='—';$('decode-text-stage').textContent='MESSAGE';
  lanes[receiver].morseCurrent='';lanes[receiver].letterCommitted=false;
}
function syncShared(role,dec){
  if(role!==receiver||sharedSeq===null)return;
  $('decode-letters').replaceChildren(...[...el(role,'letters').children].map(n=>n.cloneNode(true)));
  $('decode-progress').textContent=String(lanes[role].letters.length);
  $('decode-bytes').textContent=`${dec.bytes.length}${dec.total?' / '+dec.total:''} bytes`;
  if(sharedRevealed)$('decode-stage').textContent='復元完了';
  else if(!sharedReady)$('decode-stage').textContent=dec.header?'文字を組み立てています':'アルファベットを受信中';
}
function settleShared(text){$('decode-output').textContent=text;$('decode-output').classList.remove('reading');$('decode-text-stage').textContent='MESSAGE';$('decode-stage').textContent='復元完了';sharedRevealed=text;}
function revealShared(role,reading){
  if(role!==receiver||sharedReady!==reading.text||sharedRevealed===reading.text)return;
  const epoch=revealEpoch;
  for(const t of revealTimers)clearTimeout(t);revealTimers=[];
  $('decode-output').classList.add('reading');$('decode-output').textContent=reading.romaji;$('decode-text-stage').textContent='READING';$('decode-stage').textContent='読みを整えています';
  revealTimers.push(setTimeout(()=>{if(epoch!==revealEpoch)return;$('decode-output').classList.remove('reading');$('decode-output').textContent=reading.hiragana;$('decode-text-stage').textContent='かな';},650));
  revealTimers.push(setTimeout(()=>{if(epoch===revealEpoch)settleShared(reading.text);},1350));
}
function confirmShared(role,frame){
  if(frame.type==='ack')return;
  if(receiver!==role||sharedSeq!==frame.seq)beginReceive(frame.sender,frame.seq);
  sharedReady=frame.text;$('decode-check').textContent='✓ 受信確認';$('decode-stage').textContent='読みを整えています';
  const epoch=revealEpoch;
  if(e2bCache.has(frame.text))revealShared(role,e2bCache.get(frame.text));else{
    askE2B(role,frame.text);
    revealTimers.push(setTimeout(()=>{if(epoch===revealEpoch&&!sharedRevealed)settleShared(frame.text);},4000));
  }
}
function typedMessage(text){
  const box=$('decode-output'),before=box.dataset.text||'';
  if(!text.startsWith(before)||!before){box.replaceChildren();}
  const start=text.startsWith(before)?before.length:0;
  for(const char of text.slice(start)){const span=document.createElement('span');span.className='typed';span.textContent=char;box.append(span);}
  box.dataset.text=text;box.classList.remove('reading');
}
function phoneticProgress(role,event){
  inlineMessages[event.sender].update(event.wire,{language:lanes[role].meta?.language||'ja',boundary:event.boundary===true});$('message-state-'+event.sender).textContent='送信中';
  if(role!==receiver||sharedSeq!==event.seq)beginReceive(event.sender,event.seq);
  lanes[role].letterCommitted=true;
  $('decode-code').textContent=(event.morse||'').replaceAll('.','·').replaceAll('-','—');
  $('decode-letter').textContent=event.unit||'—';$('decode-kana').textContent=event.kana||'·';
  const rail=$('decode-letters');rail.replaceChildren();
  [...event.wire].slice(-52).forEach((char,i,all)=>{const n=document.createElement('span');n.className='l'+(char===' '?' space':'')+(i===all.length-1?' cur':'');n.textContent=char;rail.append(n);});
  $('decode-progress').textContent=String(event.wire.replaceAll(' ','').length);
  $('decode-stage').textContent='';$('decode-check').textContent='受信中';$('decode-bytes').textContent='';
  typedMessage(event.text);
}
function phoneticFrame(role,frame){
  if(frame.type==='ack'){if(frame.wire)acknowledgements[frame.sender].progress(frame.sender,frame.seq,frame.wire,{final:true,state:'received',language:lanes[role].meta?.language||'ja'});else acknowledgements[frame.sender].show(frame.sender,frame.seq,'received');log(frame.sender?'b':'a',`端末${frame.sender?'B':'A'} · ACK`,frame.text||ackText(frame.sender,frame.seq),`${turnKey(frame.sender,frame.seq)}:ack`);return;}
  if(lanes[frame.sender].messageSeq!==frame.seq)inlineMessages[frame.sender].reset();
  lanes[frame.sender].messageSeq=frame.seq;lanes[frame.sender].lastDelivered={seq:frame.seq,text:frame.text,wire:frame.wire};
  inlineMessages[frame.sender].update(frame.wire,{language:lanes[role].meta?.language||'ja',final:true,animate:false});$('message-state-'+frame.sender).textContent='✓ 届きました';
  if(role!==receiver||sharedSeq!==frame.seq)beginReceive(frame.sender,frame.seq);
  typedMessage(frame.text);sharedReady=frame.text;sharedRevealed=frame.text;
  $('decode-check').textContent='✓ 受信確認';$('decode-stage').textContent='';
  $('decode-progress').textContent=String(frame.wire.replaceAll(' ','').length);
  $('decode-heading').textContent=`${frame.sender?'B':'A'} → ${role?'B':'A'}`;
  lanes[role].text=frame.text;el(role,'text').textContent=frame.text;el(role,'romaji').textContent=frame.wire;
  el(role,'crc').textContent='CRC32 一致';
  const key=turnKey(frame.sender,frame.seq),fresh=!logEntries.get(key)?.dataset.received;
  log(frame.sender?'b':'a',`Agent ${frame.sender?'B':'A'} · ${frame.seq}`,frame.text,key);logEntries.get(key).dataset.received='true';
  metrics.turns=Math.max(metrics.turns,frame.seq);if(fresh)metrics.bytes+=frame.wire.length;bump();
}
function setStep(name){for(const li of $('steps').children)li.classList.toggle('on',li.dataset.step===name);}
function setDir(role,dir,label){const l=lanes[role];l.dir=dir;const d=el(role,'dir');d.textContent=label;d.className=`dir ${dir}`;el(role,'lane').classList.toggle('active',dir!=='idle');}
function lamp(role,on,symbol,ms){
  const L=el(role,'lamp');clearTimeout(lanes[role].lampTimer);
  L.classList.toggle('on',on);if(symbol!==undefined)el(role,'sym').textContent=symbol;
  if(on){$('now-mark').textContent=symbol==='·'?'トン':'ツー';$('now-mark').style.color=role?'#9df2d4':'#ffd27a';lanes[role].lampTimer=setTimeout(()=>{L.classList.remove('on');},Math.max(40,ms||60));}
}
function resetLane(role,keepText=false){
  const l=lanes[role];l.letters='';l.acquired=false;l.marks=0;if(!keepText){clearTimeout(l.e2bTimer);l.e2bWanted=null;l.e2bGeneration=(l.e2bGeneration||0)+1;l.text='';el(role,'text').innerHTML='<span class="caret"></span>';el(role,'romaji').textContent='';el(role,'kana').textContent='';el(role,'guess').textContent='';}
  el(role,'marks').innerHTML='<span class="empty">· ─ ·</span>';el(role,'letters').innerHTML='';el(role,'bytes').innerHTML='';el(role,'header').innerHTML='';el(role,'crc').innerHTML='<span class="pill">CRC32 待ち</span>';
}
function addMark(role,units,on){
  const box=el(role,'marks');box.querySelector('.empty')?.remove();
  if(on){const bad=units<.35||units>3.9,dash=units>=2;const m=document.createElement('span');m.className=`m ${bad?'bad':dash?'dash':'dot'}`;m.title=`${units} unit`;box.append(m);lanes[role].marks++;
    $('now-unit').textContent=`${Number(units.toFixed(2))} unit · ${Math.round(units*strip.unitMs)} ms`;}
  else{const g=document.createElement('span');g.className=units>=2.2?'lgap':'gap';box.append(g);}
  while(box.children.length>160)box.firstElementChild.remove();
  box.scrollTop=box.scrollHeight;
}
function renderLetters(role){
  const l=lanes[role],box=el(role,'letters'),bytesBox=el(role,'bytes'),dec=decodePrefix(l.letters.slice(2));
  box.innerHTML='';const total=dec.total;const first=Math.max(0,l.letters.length-56);
  [...l.letters].forEach((c,i)=>{if(i<first)return;const s=document.createElement('span');const byteIndex=Math.floor((i-2)*5/8);
    s.className='l '+(i<2?'pre':!total?(byteIndex<16?'hdr':'pay'):byteIndex<16?'hdr':byteIndex>=total-4?'crc':'pay');if(i===l.letters.length-1)s.classList.add('cur');s.textContent=c;box.append(s);});
  bytesBox.innerHTML='';const firstByte=Math.max(0,dec.bytes.length-44);dec.bytes.forEach((b,i)=>{if(i<firstByte)return;const s=document.createElement('span');s.className='b '+(i<16?'hdr':total&&i>=total-4?'crc':'pay');s.textContent=hex(b);bytesBox.append(s);});
  const h=dec.header,hb=el(role,'header');
  if(h){hb.innerHTML=`<span>magic <b>${h.magic}</b></span><span>${h.ack?'<b>ACK</b>':'DATA'}</span><span>通信コード <b>${h.room}</b></span><span>セッション <b>${h.session}</b></span><span>端末 <b>${h.sender?'B':'A'}</b></span><span>連番 <b>${h.seq}</b></span><span>本文 <b>${h.len}</b>B${h.packed?` → 展開 <b>${h.raw}</b>B (LZ)`:''}</span><span>受信 <b>${dec.bytes.length}</b>/${dec.total}B</span>`;setStep(dec.bytes.length>16?'text':'header');}
  else{hb.innerHTML=`<span>ヘッダー待ち <b>${dec.bytes.length}</b>/16 B</span>`;setStep(dec.bytes.length?'byte':'letter');}
  $('m-bytes').textContent=String(Number($('m-bytes').textContent||0));
  if(h&&!h.ack)updateText(role,dec.text);
  syncShared(role,dec);return dec;
}
function updateText(role,text){
  const l=lanes[role];if(text===l.text)return;
  const box=el(role,'text');
  if(!text.startsWith(l.text)){box.innerHTML='<span class="caret"></span>';l.text='';}
  const caret=box.querySelector('.caret');
  for(const ch of text.slice(l.text.length)){
    const s=document.createElement('span');s.className='ch stage-r';s.textContent=romajiHint(ch);caret.before(s);
    setTimeout(()=>{s.className='ch stage-k';s.textContent=nbsp(isKana(ch)?ch:(l.kanaHint?.get(ch)||ch));},160);
    setTimeout(()=>{s.className='ch';s.textContent=nbsp(ch);},340);
  }
  l.text=text;
  if(l.dir==='rx'&&l.meta?.transport!=='backend-phonetic')inlineMessages[1-role].plain(text);
  const localRomaji=kanaToRomaji(text);el(role,'romaji').textContent=localRomaji;el(role,'kana').textContent=toHira(text);
}
/* ---------- E2B readings ---------- */
let hub=null,e2bId=0;const e2bCache=new Map();
let e2bOffUntil=0;
function askE2B(role,text){
  const l=lanes[role];clearTimeout(l.e2bTimer);
  if(!text.trim())return;
  const cached=e2bCache.get(text);if(cached){applyE2B(role,cached);return;}
  if(l.e2bBusy){l.e2bWanted=text;return;}
  l.e2bTimer=setTimeout(()=>{if(hub?.readyState===1&&Date.now()>e2bOffUntil){const id=++e2bId;l.e2bBusy=true;l.e2bWanted=null;e2bPending.set(id,{role,text,generation:l.e2bGeneration});hub.send(JSON.stringify({kind:'e2b',id,text}));}},120);
}
const e2bPending=new Map();let e2bState='unknown';
function applyE2B(role,r){
  const l=lanes[role];if(!l.text.startsWith(r.text)&&r.text!==l.text)return;
  if(r.hiragana)el(role,'kana').textContent=r.hiragana+(l.text.length>r.text.length?' …':'');
  if(r.romaji)el(role,'romaji').textContent=r.romaji+(l.text.length>r.text.length?' …':'');
  el(role,'guess').textContent=r.guess&&r.guess!==l.text?r.guess:'';
  if(r.hiragana){l.kanaHint=l.kanaHint||new Map();}revealShared(role,r);
}
function onE2B(m){
  const p=e2bPending.get(m.id);e2bPending.delete(m.id);
  if(!p)return; // A reset/reconnect discarded this request.
  if(p){const l=lanes[p.role];l.e2bBusy=false;if(l.e2bWanted&&l.e2bWanted!==m.text){const want=l.e2bWanted;l.e2bWanted=null;setTimeout(()=>askE2B(p.role,want),0);}}
  if(m.error){e2bState='off';e2bOffUntil=Date.now()+8000;chip('chip-e2b','err',`E2B 応答なし (${m.error})`);return;}
  e2bState='on';chip('chip-e2b','on',`E2B ${m.latencyMs} ms`);$('m-e2b').textContent=`${m.latencyMs} ms`;
  e2bCache.set(m.text,m);if(e2bCache.size>200)e2bCache.delete(e2bCache.keys().next().value);
  if(p&&p.generation===lanes[p.role].e2bGeneration)applyE2B(p.role,m);
}
/* ---------- chips / metrics / log ---------- */
function chip(id,state,text){const c=$(id);c.className=`chip ${state}`;if(text)c.lastChild.textContent=text;}
const metrics={events:0,retry:0,bytes:0,turns:0};
function bump(){$('m-events').textContent=String(metrics.events);$('m-retry').textContent=String(metrics.retry);$('m-bytes').textContent=String(metrics.bytes);$('turns').textContent=`${metrics.turns} turns`;$('summary-turns').textContent=`${metrics.turns} ターン`;}
const logEntries=new Map();
function log(kind,label,text,key){
  const box=$('log');box.querySelector('.empty')?.remove();
  let m=key?logEntries.get(key):null;if(!m){m=document.createElement('div');if(key)logEntries.set(key,m);}m.replaceChildren();m.className=`msg ${kind}`;
  if(kind==='sys')m.textContent=text;else{const s=document.createElement('small');s.textContent=label;m.append(s,document.createTextNode(text));}
  if(!m.isConnected)box.append(m);while(box.children.length>80){const old=box.firstElementChild;for(const [k,v] of logEntries)if(v===old)logEntries.delete(k);old.remove();}box.scrollTop=box.scrollHeight;
}
function setMeta(role,meta){
  lanes[role].meta=meta;strip.unitMs=meta.unitMs||1200/meta.wpm;
  $('m-wpm').textContent=`${meta.wpm} WPM`;$('m-unit').textContent=`${Math.round(strip.unitMs*10)/10} ms`;$('m-transport').textContent=meta.transport==='backend-phonetic'?'ローマ字 / 欧文モールス':meta.transport==='backend-pcm'?'サーバー内PCM':meta.transport==='online'?'USB / オンライン（暗号化）':'音響';
  $('air-meta').textContent=`${meta.wpm} WPM · unit ${Math.round(strip.unitMs*10)/10} ms · ${meta.mode==='ai'?'Gemma自動応答':'手入力'}`;
}
/* ---------- synthetic replay of a known wire (TX side, or online RX without audio) ---------- */
function cancelReplay(role){
  const l=lanes[role];l.visualVersion=(l.visualVersion||0)+1;
  clearTimeout(l.anim);l.anim=null;l.resolveReplay?.();l.resolveReplay=null;
  clearTimeout(l.lampTimer);el(role,'lamp').classList.remove('on');
}
function snapshotWire(role,wire){
  const l=lanes[role];l.letters=wire;l.acquired=true;
  renderLetters(role);handleLetter(role,{end:true,valid:true});
}
function runWire(role,wire,dir,label,done){
  cancelReplay(role);
  const l=lanes[role],version=l.visualVersion;
  let segments;try{segments=fastSegments(wire,{wpm:l.meta?.wpm||60});}catch{
    el(role,'crc').textContent='不一致・破棄';return Promise.resolve();
  }
  resetLane(role);setDir(role,dir,label);
  const wpm=l.meta?.wpm||60,unit=1200/wpm;
  const total=segments.reduce((n,s)=>n+s.seconds*1000,0);
  // Online signals have no sound duration. Bound presentation lag and replace an
  // obsolete replay when a newer frame arrives; live phase never waits here.
  const scale=l.meta?.transport==='online'?Math.min(1,1600/total):1;
  strip.visualUnit=unit*scale;
  el(role,'replay').textContent=scale<1?'符号列を早送り表示':'符号列を再生表示';
  const letters=[...wire];let li=0,mi=0,t0=performance.now()+Math.max(15,(l.visualStart||Date.now())-Date.now()),offset=0;
  const steps=segments.map(seg=>{const step={at:offset,seg};offset+=seg.seconds*1000*scale;return step;});
  let i=0;
  l.replay=new Promise(resolve=>{
    l.resolveReplay=resolve;
    const tick=()=>{
      if(version!==l.visualVersion){resolve();return;}
      const now=performance.now();
      while(i<steps.length&&t0+steps[i].at<=now){
        const {seg,at}=steps[i],ms=seg.seconds*1000,units=Math.round(ms/unit*100)/100;
        if(seg.on){lamp(role,true,units>=2?'—':'·',ms*scale);stripPush(role,t0+at,t0+at+ms*scale,'ok');addMark(role,units,true);mi++;
          const code=INTERNATIONAL[letters[li]]||'';
          if(mi>=code.length){handleLetter(role,{mark:code,char:letters[li],acquired:l.acquired});mi=0;li++;}}
        else if(i>0)addMark(role,units,false);
        i++;
      }
      if(i<steps.length)l.anim=setTimeout(tick,16);
      else{l.anim=null;l.resolveReplay=null;handleLetter(role,{end:true,valid:true});el(role,'replay').textContent='復号表示完了';done?.();resolve();}
    };
    l.anim=setTimeout(tick,15);
  });
  return l.replay;
}
/* ---------- decoder events ---------- */
function handleLetter(role,e){
  const l=lanes[role];
  if(role===receiver&&sharedSeq!==null&&e.char){$('decode-letter').textContent=e.char;l.letterCommitted=true;}
  if(e.sync){l.acquired=true;l.letters='VV';renderLetters(role);setStep('letter');return;}
  if(e.end){
    if(l.acquired){const dec=renderLetters(role);let ok=false;try{if(e.valid&&dec.complete){parseFastWire(l.letters);ok=true;}}catch{}
      el(role,'crc').innerHTML=`<span class="pill ${ok?'ok':'bad'}">${ok?'CRC32 一致':'不一致・破棄'}</span>${dec.header?.ack?'<span class="pill ack">ACK</span>':''}`;setStep('crc');
      if(ok&&l.text&&role===receiver)askE2B(role,l.text);}
    l.acquired=false;l.letters='';return;
  }
  if(!e.acquired){ // preamble hunt: show but do not decode
    if(e.char==='V'){l.letters=(l.letters+'V').slice(-2);const box=el(role,'letters');box.innerHTML='';[...l.letters].forEach(c=>{const s=document.createElement('span');s.className='l pre';s.textContent=c;box.append(s);});
      if(l.letters==='VV'){l.acquired=true;renderLetters(role);}}
    return;
  }
  if(e.char){l.letters+=e.char;renderLetters(role);}
  else{const box=el(role,'letters');const s=document.createElement('span');s.className='l pre';s.textContent='?';box.append(s);}
}
function handleMark(role,e){
  const ms=e.units*strip.unitMs,now=performance.now();
  if(role===receiver&&sharedSeq!==null&&e.on){const l=lanes[role];if(l.letterCommitted){l.morseCurrent='';l.letterCommitted=false;}l.morseCurrent=(l.morseCurrent||'')+(e.units>=2?'—':'·');$('decode-code').textContent=l.morseCurrent;}
  const signalRole=e.signalSender===0||e.signalSender===1?e.signalSender:role;
  if(e.on){strip.canvas.dataset.signalRole=String(signalRole);lamp(signalRole,true,e.units>=2?'—':'·',Math.min(ms,400));stripPush(signalRole,now-ms,now,(e.units<.35||e.units>3.9)?'bad':'ok');setStep('mark');}
  addMark(role,e.units,e.on);
}
/* ---------- event router ---------- */
const seenTx=new Map();let displayEpoch=0,activeFeeds=0;
function demoAvailability(){$('demo').disabled=demoRunning||activeFeeds>0;$('demo').title=activeFeeds&&!demoRunning?'端末の会話を受信中です。':'';$('stop-live').disabled=!demoRunning;$('topic').disabled=demoRunning;$('topic-preset').disabled=demoRunning;$('speed').disabled=demoRunning;$('language').disabled=demoRunning;$('clear').disabled=demoRunning;}
function phase(role,state,label){
  if(state==='think'){$('flow-main').textContent=`${role?'B':'A'}が返答を考えています。`;$('flow-peer').textContent=`${role?'B':'A'} · THINK`; }
  el(role,'lane').dataset.phase=state;const l=lanes[role];l.phase=state;el(role,'phase').textContent=label;el(role,'lamp-label').textContent=label;
  for(const node of el(role,'pipeline').children)node.classList.toggle('on',node.dataset.phase===state);
}
function agentPhase(role,state,label){
  const l=lanes[role];if(l.channelBusy){l.afterChannel={state,label};return;}phase(role,state,label);
}
function cognition(role,{source,understanding,focus,thinking=false}={}){
  const box=el(role,'awareness');box.replaceChildren();box.hidden=false;box.dataset.thinking=String(thinking);
  const heading=document.createElement('div');heading.className='cognition-heading';heading.textContent=thinking?'推論 · 返答を生成中':'推論 · 理解と返答の要点';box.append(heading);
  for(const [label,value] of [['理解',understanding],['着眼点',focus|| (thinking?'受け取った内容から返答を構成しています':'')]]){
    if(!value)continue;const row=document.createElement('div'),name=document.createElement('small'),text=document.createElement('span');
    row.className='cognition-row';name.textContent=label;text.textContent=value;row.append(name,text);box.append(row);
  }
  box.dataset.source=source||'peer';
}
function offline(role,label='切断'){
  if(lanes[role].stopped)label='停止';if(lanes[role].completed)label='完了';
  chip(role?'chip-b':'chip-a','warn',label);
  phase(role,'idle',label);el(role,'lamp-label').textContent=label;
  acknowledgements[role].interrupt();
  if(inlineMessages[role].element.classList.contains('waiting'))inlineMessages[role].waiting(label==='停止'?'会話を停止しました':'入力を待っています');
  cancelReplay(role);setDir(role,'idle',label);
  const l=lanes[role];if(l.lastWire){resetLane(role);snapshotWire(role,l.lastWire);}
  const box=el(role,'awareness');if(box.dataset.thinking==='true'){box.dataset.thinking='false';const heading=box.querySelector('.cognition-heading');if(heading)heading.textContent='推論 · 中断';const rows=box.querySelectorAll('.cognition-row');if(rows.length>1)rows[rows.length-1].querySelector('span').textContent='返答の生成は完了していません';}
  if(l.messageSeq!=null)el(role,'message-state').textContent=$('message-'+role).classList.contains('receive-error')?'読み取り失敗':l.lastDelivered?.seq===l.messageSeq?'✓ 届きました':'送信停止';
}
function turnKey(sender,seq){return `${lanes[sender].meta?.session||0}:${sender}:${seq}`;}
function handle(ev,live=true){
  if(!ev||typeof ev!=='object')return;
  if(ev.kind==='monitor'){
    activeFeeds=ev.feeds||0;clearDisplay();demoAvailability();chip('chip-hub','on',`監視サーバー · feed ${ev.feeds}`);
    for(const raw of ev.history||[]){try{handle(JSON.parse(raw),false);}catch{}}
    const active=new Set(ev.roles||[]);
    for(const role of [0,1]){
      if(active.has(role))chip(role?'chip-b':'chip-a','on','接続');
      else offline(role,lanes[role].meta?'記録':'未接続');
    }
    chip('chip-e2b','warn','読み補助AI · 確認待ち');return;
  }
  if(ev.kind==='feed-open'||ev.kind==='feed-close'){
    activeFeeds=ev.feeds||0;demoAvailability();
    chip('chip-hub','on',`監視サーバー · feed ${ev.feeds}`);
    if(ev.kind==='feed-close'&&[0,1].includes(ev.role)&&!(ev.roles||[]).includes(ev.role))offline(ev.role);
    if(ev.kind==='feed-close'&&!activeFeeds)soundOutput.stop();
    return;
  }
  if(ev.kind==='e2b-result'){onE2B(ev);return;}
  if(![0,1].includes(ev.role))return;
  metrics.events++;bump();
  const role=ev.role,l=lanes[role];
  switch(ev.kind){
    case 'hello':if(live){chip(role?'chip-b':'chip-a','on','接続');phase(role,'receive','接続・入力待ち');}return;
    case 'session':{
      cancelReplay(role);resetLane(role);l.lastWire=null;l.lastFrame=null;l.completed=false;l.stopped=false;l.txTimes=new Map();l.generated='';l.messageSeq=null;l.lastDelivered=null;
      if(ev.transport==='backend-phonetic'){document.querySelector('.shared-decoder').classList.toggle('en',ev.language==='en');$('letter-label').textContent=ev.language==='en'?'LETTER':'ROMAJI';}
      setMeta(role,ev);setDir(role,'rx','受信待機');phase(role,'receive',live?'受信待機':'セッション記録');
      chip(role?'chip-b':'chip-a',live&&!ev.demo?'on':'warn',ev.demo?`デモ端末${role?'B':'A'}`:live?'接続':'記録');
      el(role,'input').textContent='相手の言葉を待っています';el(role,'output').textContent='—';el(role,'context').textContent='入力待ち';el(role,'inference').textContent='—';
      $('source-note').textContent=ev.demo?'デモ再生 · 台本の会話 / 端末・実AIの通信ではありません。':ev.transport==='backend-phonetic'?'日本語はローマ字の読み、英語は英文そのものを欧文モールスで送信。受信側でCRCを検査し、復号した本文だけをGemmaへ渡します。':ev.transport==='backend-pcm'?'サーバーの独立A/BワーカーがPCM波形を復号し、受信文をGemmaに渡して返答を生成します。音は同じPCMを画面から再生します。':ev.transport==='browser-audio'?'Gemmaの実推論 → モールスPCM音声 → 相手側のデコーダー → CRC確認。ブラウザ内の音声データ経路で、物理マイクは使いません。':ev.virtualAudio?'仮想オーディオ検証 · 実時間の音声をAudioWorkletで復号。物理マイク間の通信ではありません。':ev.transport==='online'?'USB / オンライン · 暗号化した符号列の送受信。波形は表示用の再生で、音は送信しません。':'音響モールス · 受信は端末が検出した信号、送信波形は符号列からの再生です。';
      return;}
    case 'status':if(live){el(role,'lamp-label').textContent=ev.text;$('foot-status').textContent=`${role?'B':'A'}: ${ev.text}`;}return;
    case 'topic-context':{
      cognition(role,{source:'topic',understanding:ev.topic,focus:ev.starter?'話題から最初の見解を組み立てます':'Aの発言を受け取ってから返答します',thinking:ev.starter});phase(role,ev.starter?'think':'receive',ev.starter?'話題から最初の一言を構成':'Aの発言を待機');return;}
    case 'thinking':agentPhase(role,'think','返答を推論中');return;
    case 'inference-input':
      inlineMessages[role].waiting('返答を考えています…');l.messageSeq=ev.seq;l.lastDelivered=null;el(role,'message-state').textContent='推論中';
      agentPhase(role,'think',ev.attempt?'入力を確認して再生成中':'返答を考えています');
      el(role,'input').textContent=ev.input;el(role,'context').textContent=`履歴・指示 ${ev.messageCount} 件 / 入力 ${ev.inputBytes} B / 返答上限 ${ev.maxBytes} B`;
      el(role,'inference').textContent='Gemma 4 E2B';
      cognition(role,{source:ev.inputOrigin,understanding:ev.input,thinking:true});return;
    case 'agent-awareness':{
      if(ev.understanding){cognition(role,{source:ev.source,understanding:ev.understanding,focus:ev.focus});return;}
      const box=el(role,'awareness'),received=document.createElement('b'),focus=document.createElement('em');
      received.textContent=ev.source==='topic'?`話題「${ev.received}」を理解`:`${role?'A':'B'}から受信「${ev.received}」`;focus.textContent=`→ ${ev.focus}`;box.replaceChildren(received,focus);box.hidden=false;return;}
    case 'repairing':agentPhase(role,'think','送信前に返答を再生成');el(role,'context').textContent=ev.reason;return;
    case 'generated':{
      inlineMessages[role].waiting('送信を準備しています…');el(role,'message-state').textContent='送信準備';
      const human=ev.origin?.startsWith('human-');
      l.generated=ev.text;el(role,'output-label').textContent=human?'最初の話題':'返答';el(role,'output').textContent=ev.text;
      el(role,'inference').textContent=human?'人の入力':`推論 ${(ev.inferenceMs/1000).toFixed(2)} s`;
      agentPhase(role,'send',human?'話題を送信準備':'返答を送信準備');return;}
    case 'level':return;
    case 'mark':if(live)handleMark(role,ev);return;
    case 'letter':if(live){setDir(role,'rx','受信中');handleLetter(role,ev);}return;
    case 'rx-wire':if(live){
      const wire=ev.morse.split(' ').map(m=>MORSE_REVERSE.get(m)||'?').join('');
      // ACKs confirm delivery; do not wipe out the data restoration with ACK bytes.
      try{if(parseFastWire(wire).type==='ack')return;}catch{}
      runWire(role,wire,'rx','受信');
    }return;
    case 'phonetic-character':if(live){if(ev.type==='ack')acknowledgements[ev.sender].progress(ev.sender,ev.seq,ev.wire,{boundary:ev.boundary,language:lanes[role].meta?.language||'ja'});else phoneticProgress(role,ev);}return;
    case 'preparing-reading':phase(role,'think','ことばを準備');return;
    case 'phonetic-tx':{
      if(live)soundOutput.play(ev,{wpm:l.meta?.wpm||60});
      if(ev.type==='ack'){if(ev.payload)acknowledgements[role].begin(role,ev.seq,'sending');else acknowledgements[role].show(role,ev.seq,'sending');log(role?'b':'a',`端末${role?'B':'A'} · ACK`,ev.text||ackText(role,ev.seq),`${turnKey(role,ev.seq)}:ack`);return;}
      acknowledgements[role].hide();
      if(live||l.messageSeq!==ev.seq){l.messageSeq=ev.seq;l.lastDelivered=null;inlineMessages[role].reset();$('message-state-'+role).textContent=live?'送信中':'記録';}
      const key=turnKey(role,ev.seq);l.txTimes=l.txTimes||new Map();l.txTimes.set(ev.seq,ev.t||Date.now());
      log(role?'b':'a',`Agent ${role?'B':'A'} · ${ev.seq}`,ev.text,key);metrics.turns=Math.max(metrics.turns,ev.seq);bump();return;}
    case 'presentation-start':
      if(lanes[ev.sender]?.messageSeq===ev.seq)el(ev.sender,'message-state').textContent='漢字に整えています';return;
    case 'message-display':{
      const writer=lanes[ev.sender];if(!writer||writer.meta?.session!==ev.session)return;
      if(ev.type==='ack'){acknowledgements[ev.sender].format(ev.sender,ev.seq,ev.wire,ev.text);log(ev.sender?'b':'a',`端末${ev.sender?'B':'A'} · ACK`,ev.text,`${turnKey(ev.sender,ev.seq)}:ack`);return;}
      if(writer.messageSeq===ev.seq&&writer.lastDelivered?.wire===ev.wire&&writer.lastDelivered.text===ev.received){
        if(inlineMessages[ev.sender].format(ev.text,{wire:ev.wire}))el(ev.sender,'message-state').textContent='✓ 届きました';
      }
      const key=turnKey(ev.sender,ev.seq);if(logEntries.has(key))log(ev.sender?'b':'a',`端末${ev.sender?'B':'A'} · ${ev.seq}`,ev.text,key);return;}
    case 'presentation-end':
      if(lanes[ev.sender]?.messageSeq===ev.seq&&lanes[ev.sender]?.lastDelivered?.seq===ev.seq)el(ev.sender,'message-state').textContent='✓ 届きました';return;
    case 'frame':{
      const f=ev.frame;if(!f)return;
      if(l.meta?.transport==='backend-phonetic'){phoneticFrame(role,f);return;}
      if(f.type==='ack')return;
      const key=turnKey(f.sender,f.seq),isNew=!logEntries.get(key)?.dataset.received;
      log(f.sender?'b':'a',`端末${f.sender?'B':'A'} → 端末${role?'B':'A'} · ${f.seq} · 受信確認`,f.text,key);
      logEntries.get(key).dataset.received='true';
      metrics.turns=Math.max(metrics.turns,f.seq);if(isNew)metrics.bytes+=new TextEncoder().encode(f.text).length;bump();
      confirmShared(role,f);l.lastFrame=f;try{l.lastWire=fastWire(packFastFrame(f));}catch{}
      if(l.phase!=='think'&&l.phase!=='send')phase(role,'receive','本文を復元・受信完了');
      const finish=()=>{updateText(role,f.text);el(role,'crc').innerHTML='<span class="pill ok">CRC32 一致 · 本文確定</span>';};
      if(live&&l.anim){const version=l.visualVersion;(l.replay||Promise.resolve()).then(()=>{if(version===l.visualVersion)finish();});}
      else{if(l.lastWire)snapshotWire(role,l.lastWire);finish();}
      return;}
    case 'channel':{
      const key=`${ev.sender}:${ev.seq}:${ev.type}`;
      if(ev.phase==='complete'){
        for(const side of [ev.sender,role]){const state=lanes[side];if(state.channelBusy===key){state.channelBusy=null;const next=state.afterChannel;state.afterChannel=null;if(next)phase(side,next.state,next.label);}}
      }else{
        lanes[ev.sender].channelBusy=key;lanes[role].channelBusy=key;
        if(ev.type==='data'){beginReceive(ev.sender,ev.seq);phase(ev.sender,'send','送信中');phase(role,'receive','聞いています');$('flow-main').textContent=`${ev.sender?'B':'A'}が送り、${role?'B':'A'}が聞いています。`;$('flow-peer').textContent=`${ev.sender?'B':'A'} → ${role?'B':'A'}`;}
        else if(ev.type==='ack'){phase(ev.sender,'ack','受信確認を送信');phase(role,'ack','到達確認を待機');}
      }
      return;}
    case 'tx':{
      if(live&&l.meta?.transport==='backend-pcm')soundOutput.play(ev,{wpm:l.meta.wpm});
      if(ev.type==='ack')return;
      if(l.meta?.transport!=='backend-pcm'&&live)beginReceive(role,ev.seq);
      l.visualStart=ev.audioStart;
      const key=turnKey(role,ev.seq),retry=seenTx.has(key);seenTx.set(key,true);if(seenTx.size>128)seenTx.delete(seenTx.keys().next().value);
      l.txTimes=l.txTimes||new Map();l.txTimes.set(ev.seq,ev.t||Date.now());
      metrics.turns=Math.max(metrics.turns,ev.seq);bump();
      if(!logEntries.get(key)?.dataset.received)log(role?'b':'a',`端末${role?'B':'A'} → 端末${role?'A':'B'} · ${ev.seq} · 送信`,ev.text,key);
      phase(role,'send',retry?'符号列を再送中':'符号列を送信・ACK待ち');
      if(!l.generated){el(role,'output-label').textContent='送信する本文';el(role,'output').textContent=ev.text;}
      l.lastWire=ev.wire;
      const raw=new TextEncoder().encode(ev.text).length;$('m-comp').textContent=ev.bytes?`${raw}B → ${ev.bytes.length-20}B`:'—';
      if(live&&ev.wire)runWire(role,ev.wire,'tx','送信');
      else if(ev.wire)snapshotWire(role,ev.wire);
      return;}
    case 'delivered':{
      const start=l.txTimes?.get(ev.seq),rtt=start?Math.max(0,(ev.t||Date.now())-start):null;
      l.txTimes?.delete(ev.seq);
      if(rtt!==null)$('m-ack').textContent=`${rtt} ms`;
      agentPhase(role,'ack','返答を待っています');
      if((lanes[1-role].messageSeq||0)<ev.seq+1){inlineMessages[1-role].waiting();el(1-role,'message-state').textContent='返答待ち';}
      return;}
    case 'ack-sent':if(acknowledgements[role].inline)acknowledgements[role].begin(role,ev.seq,'sent');else acknowledgements[role].show(role,ev.seq,'sent');return;
    case 'timeout':metrics.retry++;bump();phase(role,'send','受信確認なし・再送');return;
    case 'duplicate':return;
    case 'invalid':case 'error':
      cancelReplay(role);el(role,'crc').textContent=ev.message||'不一致・破棄';phase(role,'error','通信エラー');
      if([0,1].includes(ev.signalSender)&&typeof ev.rawText==='string'){
        inlineMessages[ev.signalSender].plain(ev.rawText||'信号を読み取れませんでした');$('message-'+ev.signalSender).classList.add('receive-error');el(ev.signalSender,'message-state').textContent='読み取り失敗';
      }
      log('sys','',`端末${role?'B':'A'}: ${ev.message||ev.kind}`);return;
    case 'complete':l.completed=true;agentPhase(role,'idle','会話完了');$('flow-main').textContent='会話が完了しました。';$('flow-peer').textContent='A ⟷ B';return;
    case 'stopped':l.stopped=true;offline(role,'停止');return;
    default:return;
  }
}
function clearDisplay(){
  for(const role of [0,1]){inlineMessages[role].reset();acknowledgements[role].hide();$('message-state-'+role).textContent='待機';}
  displayEpoch++;demoRunning=false;demoAvailability();cancelReveal();sharedSeq=null;$('decode-output').textContent='—';$('decode-output').dataset.text='';$('decode-kana').textContent='—';$('decode-letters').replaceChildren();$('decode-code').textContent='· — ·';$('decode-letter').textContent='—';$('decode-progress').textContent='0';$('decode-heading').textContent='信号から、言葉へ。';$('decode-check').textContent='受信待ち';$('decode-stage').textContent='受信待ち';$('decode-bytes').textContent='—';
  for(const role of [0,1]){
    cancelReplay(role);resetLane(role);const l=lanes[role];l.lastWire=null;l.generated='';l.lastFrame=null;l.txTimes=new Map();l.channelBusy=null;l.afterChannel=null;l.messageSeq=null;l.lastDelivered=null;
    setDir(role,'idle','待機');phase(role,'idle','入力待ち');el(role,'input').textContent='相手の言葉を待っています';el(role,'output').textContent='—';el(role,'context').textContent='入力待ち';el(role,'inference').textContent='—';el(role,'replay').textContent='復号待ち';cognition(role,{source:'waiting',understanding:'話題を受け取ると、理解と着眼点を表示します',focus:'入力待ち'});
    l.e2bBusy=false;l.e2bWanted=null;
  }
  e2bPending.clear();seenTx.clear();logEntries.clear();
  $('log').innerHTML='<p class="empty">まだ通信はありません。</p>';strip.blocks=[];
  Object.assign(metrics,{events:0,retry:0,bytes:0,turns:0});bump();
  $('m-ack').textContent='—';$('m-comp').textContent='—';$('m-e2b').textContent='—';
}
/* ---------- hub connection ---------- */
function connect(){
  hub=new WebSocket(`ws://${location.host}/view`);
  hub.onopen=()=>chip('chip-hub','on','監視サーバー 接続');
  hub.onmessage=e=>{try{handle(JSON.parse(e.data));}catch(err){console.warn(err);}};
  hub.onclose=()=>{
    chip('chip-hub','err','監視サーバー 切断');hub=null;if(localConversation?.active)localConversation.finish(Error('接続が切れました。もう一度開始してください。'));activeFeeds=0;demoAvailability();
    for(const r of [0,1]){offline(r,'監視切断');lanes[r].e2bBusy=false;lanes[r].e2bWanted=null;}
    e2bPending.clear();setTimeout(connect,1500);
  };
}
connect();
/* ---------- playable local conversation ---------- */
let demoRunning=false,localConversation=null,soundEnabled=true;
const englishTopics={music:'Why does music change your mood?',food:'What can we cook with vegetables?',science:'What would a home in space be like?',creative:'Imagine a mysterious little town.'};
const topics={music:'音楽で気分が変わるのはどうして？',food:'残り野菜で、おいしい一皿を考えよう。',science:'宇宙で暮らすなら、どんな家に住みたい？',creative:'不思議な街を舞台に、物語を考えよう。'};
function showError(error){$('session-error').hidden=!error;$('session-error').textContent=error?.message||'';}
function soundState({rms,peak,state,enabled,volume,playing}){
  $('sound').classList.toggle('sounding',rms>.002);$('sound').dataset.rms=String(rms);$('sound').dataset.audioState=state;$('sound').dataset.peak=String(peak);
  $('sound').dataset.playing=String(playing);
  $('sound').setAttribute('aria-pressed',String(enabled&&state==='running'&&volume>0));
  $('sound-label').textContent=!enabled?'ミュート':!volume?'音量 0':state==='running'?'音あり':'音を有効に';
}
const soundOutput=new SignalAudio({onState:soundState});
try{const saved=JSON.parse(localStorage.getItem('morsetalk-monitor-sound')||'null');if(saved){soundEnabled=saved.enabled!==false;$('volume').value=String(saved.volume??40);}}catch{}
soundOutput.configure({enabled:soundEnabled,volume:Number($('volume').value)/100});
function saveSound(){try{localStorage.setItem('morsetalk-monitor-sound',JSON.stringify({enabled:soundEnabled,volume:Number($('volume').value)}));}catch{}}
async function startConversation(){
  if(demoRunning||activeFeeds)return;
  const topic=$('topic').value.trim();if(!topic){showError(Error('話題を入力してください。'));return;}
  clearDisplay();showError(null);demoRunning=true;demoAvailability();$('session-state').textContent='接続中';
  soundOutput.configure({enabled:soundEnabled,volume:Number($('volume').value)/100});
  localConversation=new SignalConversation({language:$('language').value,wpm:Number($('speed').value),audio:soundOutput,
    onFinished:error=>{
      demoRunning=false;demoAvailability();showError(error);
      $('session-state').textContent=error?(/受信確認|CRC|モールス|読み取/.test(error.message)?'読み取り失敗':'接続を確認'):localConversation.completed.size===2?'会話完了':'停止';
    }
  });
  $('session-state').textContent='会話中';
  try{await localConversation.start(topic);}catch(error){localConversation.finish(error);}
}
$('demo').addEventListener('click',startConversation);
$('stop-live').addEventListener('click',()=>localConversation?.stop());
function selectTopic(){$('topic').maxLength=$('language').value==='en'?56:22;$('topic').value=($('language').value==='en'?englishTopics:topics)[$('topic-preset').value];}
$('topic-preset').addEventListener('change',selectTopic);$('language').addEventListener('change',selectTopic);
$('sound').addEventListener('click',async()=>{
  try{
    if(soundOutput.context?.state!=='running'){soundEnabled=true;soundOutput.configure({enabled:true});await soundOutput.unlock();}
    else{soundEnabled=!soundEnabled;soundOutput.configure({enabled:soundEnabled});}
    saveSound();
  }catch(error){showError(error);}
});
$('sound-test').addEventListener('click',async()=>{try{showError(null);soundEnabled=true;soundOutput.configure({enabled:true,volume:Number($('volume').value)/100});await soundOutput.test();saveSound();}catch(error){showError(error);}});
$('volume').addEventListener('input',()=>{if(Number($('volume').value)>0)soundEnabled=true;soundOutput.configure({enabled:soundEnabled,volume:Number($('volume').value)/100});saveSound();});
$('fullscreen').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{showError(Error('このブラウザでは全画面を使用できません。'));}
});
$('clear').addEventListener('click',clearDisplay);
