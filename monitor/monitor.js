/* MorseTalk Signal Monitor. Renders what the endpoints report while they decode:
 * dit/dah timing → International Morse letter → Base32 → bytes → LZ → UTF-8 → CRC.
 * The page never controls an endpoint. Optional readings/guesses come from a local Gemma 4 E2B. */
import { packFastFrame, fastWire, fastSegments, unpackFastFrame } from '../app/core/fast-codec.mjs';
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
  return {magic:String.fromCharCode(bytes[0],bytes[1]),ack:Boolean(bytes[2]&1),packed:Boolean(bytes[2]&4),room:String(v.getUint16(3)).padStart(4,'0'),session:v.getUint32(5).toString(16).toUpperCase().padStart(8,'0'),sender:bytes[9],seq:v.getUint16(10),len:v.getUint16(12),raw:v.getUint16(14)};
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
  const c=strip.canvas,ctx=c.getContext('2d'),dpr=window.devicePixelRatio||1,W=c.clientWidth,H=150;
  if(c.width!==Math.round(W*dpr)||c.height!==Math.round(H*dpr)){c.width=Math.round(W*dpr);c.height=Math.round(H*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  const now=performance.now(),pxPerMs=Math.min(.5,Math.max(.08,7/strip.unitMs)),span=W/pxPerMs;
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
function setStep(name){for(const li of $('steps').children)li.classList.toggle('on',li.dataset.step===name);}
function setDir(role,dir,label){const l=lanes[role];l.dir=dir;const d=el(role,'dir');d.textContent=label;d.className=`dir ${dir}`;el(role,'lane').classList.toggle('active',dir!=='idle');}
function lamp(role,on,symbol,ms){
  const L=el(role,'lamp');clearTimeout(lanes[role].lampTimer);
  L.classList.toggle('on',on);if(symbol!==undefined)el(role,'sym').textContent=symbol;
  if(on){$('now-mark').textContent=symbol==='·'?'トン':'ツー';$('now-mark').style.color=role?'#9df2d4':'#ffd27a';lanes[role].lampTimer=setTimeout(()=>{L.classList.remove('on');},Math.max(40,ms||60));}
}
function resetLane(role,keepText=false){
  const l=lanes[role];l.letters='';l.acquired=false;l.marks=0;if(!keepText){l.text='';el(role,'text').innerHTML='<span class="caret"></span>';el(role,'romaji').textContent='';el(role,'kana').textContent='';el(role,'guess').textContent='';}
  el(role,'marks').innerHTML='<span class="empty">· ─ ·</span>';el(role,'letters').innerHTML='';el(role,'bytes').innerHTML='';el(role,'header').innerHTML='';el(role,'crc').innerHTML='<span class="pill">CRC32 待ち</span>';
}
function addMark(role,units,on){
  const box=el(role,'marks');box.querySelector('.empty')?.remove();
  if(on){const bad=units<.35||units>3.9,dash=units>=2;const m=document.createElement('span');m.className=`m ${bad?'bad':dash?'dash':'dot'}`;m.title=`${units} unit`;box.append(m);lanes[role].marks++;
    $('now-unit').textContent=`${units} unit · ${Math.round(units*strip.unitMs)} ms`;}
  else{const g=document.createElement('span');g.className=units>=2.2?'lgap':'gap';box.append(g);}
  while(box.children.length>160)box.firstElementChild.remove();
  box.scrollTop=box.scrollHeight;
}
function renderLetters(role){
  const l=lanes[role],box=el(role,'letters'),bytesBox=el(role,'bytes'),dec=decodePrefix(l.letters.slice(2));
  box.innerHTML='';const total=dec.total;
  [...l.letters].forEach((c,i)=>{const s=document.createElement('span');const byteIndex=Math.floor((i-2)*5/8);
    s.className='l '+(i<2?'pre':!total?(byteIndex<16?'hdr':'pay'):byteIndex<16?'hdr':byteIndex>=total-4?'crc':'pay');if(i===l.letters.length-1)s.classList.add('cur');s.textContent=c;box.append(s);});
  bytesBox.innerHTML='';dec.bytes.forEach((b,i)=>{const s=document.createElement('span');s.className='b '+(i<16?'hdr':total&&i>=total-4?'crc':'pay');s.textContent=hex(b);bytesBox.append(s);});
  const h=dec.header,hb=el(role,'header');
  if(h){hb.innerHTML=`<span>magic <b>${h.magic}</b></span><span>${h.ack?'<b>ACK</b>':'DATA'}</span><span>通信コード <b>${h.room}</b></span><span>セッション <b>${h.session}</b></span><span>端末 <b>${h.sender?'B':'A'}</b></span><span>連番 <b>${h.seq}</b></span><span>本文 <b>${h.len}</b>B${h.packed?` → 展開 <b>${h.raw}</b>B (LZ)`:''}</span><span>受信 <b>${dec.bytes.length}</b>/${dec.total}B</span>`;setStep(dec.bytes.length>16?'text':'header');}
  else{hb.innerHTML=`<span>ヘッダー待ち <b>${dec.bytes.length}</b>/16 B</span>`;setStep(dec.bytes.length?'byte':'letter');}
  $('m-bytes').textContent=String(Number($('m-bytes').textContent||0));
  if(h&&!h.ack)updateText(role,dec.text);
  return dec;
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
  const localRomaji=kanaToRomaji(text);el(role,'romaji').textContent=localRomaji;el(role,'kana').textContent=toHira(text);
  askE2B(role,text);
}
/* ---------- E2B readings ---------- */
let hub=null,e2bId=0;const e2bCache=new Map();
function askE2B(role,text){
  const l=lanes[role];clearTimeout(l.e2bTimer);
  if(!text.trim())return;
  const cached=e2bCache.get(text);if(cached){applyE2B(role,cached);return;}
  l.e2bTimer=setTimeout(()=>{if(hub?.readyState===1&&e2bState!=='off'){const id=++e2bId;e2bPending.set(id,{role,text});hub.send(JSON.stringify({kind:'e2b',id,text}));}},120);
}
const e2bPending=new Map();let e2bState='unknown';
function applyE2B(role,r){
  const l=lanes[role];if(!l.text.startsWith(r.text)&&r.text!==l.text)return;
  if(r.hiragana)el(role,'kana').textContent=r.hiragana+(l.text.length>r.text.length?' …':'');
  if(r.romaji)el(role,'romaji').textContent=r.romaji+(l.text.length>r.text.length?' …':'');
  el(role,'guess').textContent=r.guess&&r.guess!==l.text?r.guess:'';
  if(r.hiragana){l.kanaHint=l.kanaHint||new Map();}
}
function onE2B(m){
  const p=e2bPending.get(m.id);e2bPending.delete(m.id);
  if(m.error){e2bState='off';chip('chip-e2b','err','E2B 未接続');return;}
  e2bState='on';chip('chip-e2b','on',`E2B ${m.latencyMs} ms`);$('m-e2b').textContent=`${m.latencyMs} ms`;
  e2bCache.set(m.text,m);if(e2bCache.size>200)e2bCache.delete(e2bCache.keys().next().value);
  if(p)applyE2B(p.role,m);
}
/* ---------- chips / metrics / log ---------- */
function chip(id,state,text){const c=$(id);c.className=`chip ${state}`;if(text)c.lastChild.textContent=text;}
const metrics={events:0,retry:0,bytes:0,turns:0};
function bump(){$('m-events').textContent=String(metrics.events);$('m-retry').textContent=String(metrics.retry);$('m-bytes').textContent=String(metrics.bytes);$('turns').textContent=`${metrics.turns} turns`;}
function log(kind,label,text){
  const box=$('log');box.querySelector('.empty')?.remove();
  const m=document.createElement('div');m.className=`msg ${kind}`;
  if(kind==='sys')m.textContent=text;else{const s=document.createElement('small');s.textContent=label;m.append(s,document.createTextNode(text));}
  box.append(m);while(box.children.length>80)box.firstElementChild.remove();box.scrollTop=box.scrollHeight;
}
function setMeta(role,meta){
  lanes[role].meta=meta;strip.unitMs=meta.unitMs||1200/meta.wpm;
  $('m-wpm').textContent=`${meta.wpm} WPM`;$('m-unit').textContent=`${Math.round(strip.unitMs*10)/10} ms`;$('m-transport').textContent=meta.transport==='online'?'USB / オンライン（暗号化）':'音響（スピーカー↔マイク）';
  $('air-meta').textContent=`${meta.wpm} WPM · unit ${Math.round(strip.unitMs*10)/10} ms · ${meta.mode==='ai'?'Gemma自動応答':'手入力'}`;
}
/* ---------- synthetic replay of a known wire (TX side, or online RX without audio) ---------- */
function runWire(role,wire,dir,label,done){
  const l=lanes[role];if(l.anim){clearTimeout(l.anim);l.anim=null;}
  resetLane(role);setDir(role,dir,label);
  const wpm=l.meta?.wpm||60,unit=1200/wpm;const segments=fastSegments(wire,{wpm});
  // letter boundaries: after each letter's marks, the letter event fires.
  const letters=[...wire];let li=0,mi=0,t0=performance.now()+30,offset=0;
  const steps=[];
  for(const s of segments){steps.push({at:offset,seg:s});offset+=s.seconds*1000;}
  let i=0;
  const tick=()=>{
    const now=performance.now();
    while(i<steps.length&&t0+steps[i].at<=now){
      const {seg}=steps[i],ms=seg.seconds*1000,units=Math.round(seg.seconds/(unit/1000)*100)/100;
      if(seg.on){lamp(role,true,units>=2?'—':'·',ms);stripPush(role,now,now+ms,'ok');addMark(role,units,true);mi++;
        const code=INTERNATIONAL[letters[li]]||'';
        if(mi>=code.length){handleLetter(role,{mark:code,char:letters[li],acquired:l.acquired});mi=0;li++;}}
      else if(i>0){addMark(role,units,false);}
      i++;
    }
    if(i<steps.length)l.anim=setTimeout(tick,8);
    else{l.anim=null;handleLetter(role,{end:true,valid:true});done?.();}
  };
  l.anim=setTimeout(tick,30);
}
/* ---------- decoder events ---------- */
function handleLetter(role,e){
  const l=lanes[role];
  if(e.sync){l.acquired=true;l.letters='VV';renderLetters(role);setStep('letter');return;}
  if(e.end){
    if(l.acquired){const dec=renderLetters(role);const ok=e.valid&&dec.complete;
      el(role,'crc').innerHTML=`<span class="pill ${ok?'ok':'bad'}">${ok?'CRC32 一致':'不一致・破棄'}</span>${dec.header?.ack?'<span class="pill ack">ACK</span>':''}`;setStep('crc');
      if(ok)metrics.bytes+=dec.bytes.length;bump();}
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
  if(e.on){lamp(role,true,e.units>=2?'—':'·',Math.min(ms,400));stripPush(role,now-ms,now,(e.units<.35||e.units>3.9)?'bad':'ok');setStep('mark');}
  addMark(role,e.units,e.on);
}
/* ---------- event router ---------- */
const seenTx=new Map();
function handle(ev,live=true){
  metrics.events++;bump();
  const role=ev.role===1?1:0,l=lanes[role];
  switch(ev.kind){
    case 'monitor':chip('chip-hub','on',`監視サーバー · feed ${ev.feeds}`);if(ev.e2b===false){e2bState='off';chip('chip-e2b','err','E2B 未接続');}else chip('chip-e2b',ev.e2b?'on':'warn',ev.e2b?'E2B 準備済み':'E2B 確認中');for(const raw of ev.history||[]){try{const h=JSON.parse(raw);if(['session','frame','tx','generated','stopped'].includes(h.kind))handle(h,false);}catch{}}return;
    case 'feed-open':case 'feed-close':chip('chip-hub','on',`監視サーバー · feed ${ev.feeds}`);return;
    case 'hello':chip(role?'chip-b':'chip-a','on',`端末${role?'B':'A'} 接続`);return;
    case 'session':chip(role?'chip-b':'chip-a','on',`端末${role?'B':'A'} · ${ev.wpm} WPM`);setMeta(role,ev);log('sys','',`端末${role?'B':'A'}: ${ev.transport==='online'?'USB/オンライン':'音響'} · ${ev.wpm} WPM · ${ev.mode==='ai'?'Gemma自動応答':'手入力'} · 通信コード ${ev.room}`);if(live){resetLane(role);setDir(role,'rx','受信待機');}return;
    case 'status':el(role,'lamp-label').textContent=ev.text;$('foot-status').textContent=`${role?'B':'A'}: ${ev.text}`;return;
    case 'level':return;
    case 'mark':if(live)handleMark(role,ev);return;
    case 'letter':if(live){if(l.dir!=='rx')setDir(role,'rx','受信中');handleLetter(role,ev);}return;
    case 'rx-wire':if(live){const wire=ev.morse.split(' ').map(m=>MORSE_REVERSE.get(m)||'?').join('');runWire(role,wire,'rx','受信（暗号化経路を再生）');}return;
    case 'frame':{const f=ev.frame;if(f.type==='ack'){if(live){el(role,'crc').innerHTML='<span class="pill ok">CRC32 一致</span><span class="pill ack">ACK 受信</span>';}return;}
      metrics.turns=Math.max(metrics.turns,f.seq);bump();log(f.sender?'b':'a',`端末${f.sender?'B':'A'} → 端末${role?'B':'A'} · ターン ${f.seq}`,f.text);
      if(live){const finish=()=>{updateText(role,f.text);el(role,'crc').innerHTML='<span class="pill ok">CRC32 一致 · 本文確定</span>';setDir(role,'rx','受信完了');};if(l.anim){const prev=l.anim;const wait=()=>{if(l.anim)setTimeout(wait,50);else finish();};wait();}else finish();}
      return;}
    case 'tx':{if(ev.type==='ack'){if(live){el(role,'crc').innerHTML='<span class="pill ack">ACK 送信</span>';}return;}
      const key=`${role}:${ev.seq}:${ev.text}`;const retry=seenTx.has(key);seenTx.set(key,performance.now());l.txAt=performance.now();
      if(!retry){metrics.turns=Math.max(metrics.turns,ev.seq);log(role?'b':'a',`端末${role?'B':'A'} 送信 · ターン ${ev.seq} · ${ev.bytes?.length||''}B`,ev.text);}
      if(live){runWire(role,ev.wire,'tx',retry?'再送中':'送信中',()=>{updateText(role,ev.text);el(role,'crc').innerHTML='<span class="pill ok">送信完了 · ACK待ち</span>';});
        const raw=new TextEncoder().encode(ev.text).length;$('m-comp').textContent=ev.bytes?`${raw}B → ${ev.bytes.length-20}B`:'—';}
      return;}
    case 'generated':log('sys','',`端末${role?'B':'A'} の Gemma が生成 (${(ev.inferenceMs/1000).toFixed(1)} s): ${ev.text}`);return;
    case 'delivered':{const rtt=l.txAt?Math.round(performance.now()-l.txAt):null;if(live){el(role,'crc').innerHTML=`<span class="pill ok">相手が受信確認 (ACK)</span>${rtt?`<span class="pill">${rtt} ms</span>`:''}`;setDir(role,'idle','待機');}if(rtt)$('m-ack').textContent=`${rtt} ms`;return;}
    case 'timeout':metrics.retry++;bump();log('sys','',`端末${role?'B':'A'}: 受信確認なし → ${ev.attempt?'再送も失敗':'再送'}`);return;
    case 'duplicate':log('sys','',`端末${role?'B':'A'}: 重複受信を抑制 (ターン ${ev.seq})`);return;
    case 'invalid':case 'error':if(live){el(role,'crc').innerHTML=`<span class="pill bad">${ev.message||'受信診断'}</span>`;}log('sys','',`端末${role?'B':'A'}: ${ev.message||ev.kind}`);return;
    case 'stopped':log('sys','',`端末${role?'B':'A'} 停止: ${ev.message||''}`);if(live){setDir(role,'idle','停止');chip(role?'chip-b':'chip-a','warn',`端末${role?'B':'A'} 停止`);}return;
    case 'e2b-result':onE2B(ev);return;
    default:return;
  }
}
/* ---------- hub connection ---------- */
function connect(){
  const url=`ws://${location.host}/view`;hub=new WebSocket(url);
  hub.onopen=()=>chip('chip-hub','on','監視サーバー 接続');
  hub.onmessage=e=>{try{handle(JSON.parse(e.data));}catch(err){console.warn(err);}};
  hub.onclose=()=>{chip('chip-hub','err','監視サーバー 切断');hub=null;setTimeout(connect,1500);};
}
connect();
/* ---------- demo without phones ---------- */
const DEMO=[[0,'こんにちは、Pixel 9a です。聞こえますか？'],[1,'はい、Pixel 7 です。ちゃんと届いています！'],[0,'点と線で日本語がそのまま届くのが面白いですね。'],[1,'圧縮した本文をモールスで運んでいるからです。']];
let demoRunning=false;
async function demo(){
  if(demoRunning)return;demoRunning=true;$('demo').disabled=true;
  const session=0x20260912;
  for(const role of [0,1]){handle({kind:'session',role,transport:'acoustic',wpm:60,unitMs:20,room:'0000',session,mode:'manual',maxTurns:8});}
  let seq=1;
  for(const [role,text] of DEMO){
    const bytes=packFastFrame({text,room:'0000',session,sender:role,seq}),wire=fastWire(bytes);
    handle({kind:'tx',role,seq,type:'data',text,sender:role,wire,bytes:Array.from(bytes)});
    await new Promise(r=>setTimeout(r,fastSegments(wire,{wpm:60}).reduce((n,s)=>n+s.seconds,0)*1000+200));
    const other=1-role;
    handle({kind:'rx-wire',role:other,morse:[...wire].map(c=>INTERNATIONAL[c]).join(' ')});
    await new Promise(r=>setTimeout(r,fastSegments(wire,{wpm:60}).reduce((n,s)=>n+s.seconds,0)*1000+250));
    handle({kind:'frame',role:other,frame:unpackFastFrame(bytes)});
    await new Promise(r=>setTimeout(r,500));
    handle({kind:'tx',role:other,seq,type:'ack',text:'',sender:other});handle({kind:'delivered',role,seq});
    await new Promise(r=>setTimeout(r,900));seq++;
  }
  demoRunning=false;$('demo').disabled=false;
}
$('demo').addEventListener('click',demo);
$('clear').addEventListener('click',()=>{for(const r of [0,1]){resetLane(r);setDir(r,'idle','待機');}$('log').innerHTML='<p class="empty">表示を消去しました。</p>';strip.blocks=[];metrics.events=0;metrics.retry=0;metrics.bytes=0;metrics.turns=0;bump();});
