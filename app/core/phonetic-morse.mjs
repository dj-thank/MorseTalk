/** Human-readable International Morse: WA -> わ is actual payload decoding.
 * Kana syllables are word-delimited. Header/CRC also travel as Morse characters.
 */
import { INTERNATIONAL, encodeText, decodeCode, codeToSegments, synthesize } from './morse.mjs';
import { ToneDetector } from './dsp.mjs';
import { crc32 } from './packet.mjs';
import { utf8Encode } from './utf8.mjs';

const pairs='A:あ I:い U:う E:え O:お KA:か KI:き KU:く KE:け KO:こ SA:さ SHI:し SU:す SE:せ SO:そ TA:た CHI:ち TSU:つ TE:て TO:と NA:な NI:に NU:ぬ NE:ね NO:の HA:は HI:ひ FU:ふ HE:へ HO:ほ MA:ま MI:み MU:む ME:め MO:も YA:や YU:ゆ YO:よ RA:ら RI:り RU:る RE:れ RO:ろ WA:わ WO:を N:ん GA:が GI:ぎ GU:ぐ GE:げ GO:ご ZA:ざ JI:じ ZU:ず ZE:ぜ ZO:ぞ DA:だ DI:ぢ DU:づ DE:で DO:ど BA:ば BI:び BU:ぶ BE:べ BO:ぼ PA:ぱ PI:ぴ PU:ぷ PE:ぺ PO:ぽ KYA:きゃ KYU:きゅ KYO:きょ SHA:しゃ SHU:しゅ SHO:しょ CHA:ちゃ CHU:ちゅ CHO:ちょ NYA:にゃ NYU:にゅ NYO:にょ HYA:ひゃ HYU:ひゅ HYO:ひょ MYA:みゃ MYU:みゅ MYO:みょ RYA:りゃ RYU:りゅ RYO:りょ GYA:ぎゃ GYU:ぎゅ GYO:ぎょ JA:じゃ JU:じゅ JO:じょ BYA:びゃ BYU:びゅ BYO:びょ PYA:ぴゃ PYU:ぴゅ PYO:ぴょ XA:ぁ XI:ぃ XU:ぅ XE:ぇ XO:ぉ XYA:ゃ XYU:ゅ XYO:ょ XTU:っ XWA:ゎ VU:ゔ';
export const ROMAJI_KANA=Object.freeze({...Object.fromEntries(pairs.split(' ').map(p=>p.split(':'))),'-':'ー',',':'、','.':'。','?':'？',':':'：'});
const kanaRomaji=new Map(Object.entries(ROMAJI_KANA).map(([r,k])=>[k,r]));
const tokens=Object.keys(ROMAJI_KANA);
export function kanaToWire(text){
  const kana=String(text).normalize('NFKC').replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[！!]/g,'。').replace(/\?/g,'？').replace(/\./g,'。').replace(/,/g,'、').replace(/:/g,'：').replace(/\s/g,'');
  const result=[];
  for(let i=0;i<kana.length;){const pair=kana.slice(i,i+2),one=kana[i],key=kanaRomaji.has(pair)?pair:one;const value=kanaRomaji.get(key);if(!value)throw Error(`読みをかなにできません: ${key}`);result.push(value);i+=key.length;}
  if(!result.length||result.length>96)throw Error('読みは短い一文にしてください。');
  return {wire:result.join(' '),text:result.map(r=>ROMAJI_KANA[r]).join('')};
}
export function wireToKana(wire,{partial=false}={}){
  const list=wire.split(' ');let text='',unit='',kana='';
  for(let i=0;i<list.length;i++){
    const t=list[i];if(!t)continue;unit=t;kana='';
    const open=partial&&i===list.length-1;
    if(open&&tokens.some(k=>k.startsWith(t)&&k!==t))continue;
    if(!ROMAJI_KANA[t]){if(open&&tokens.some(k=>k.startsWith(t)))continue;throw Error(`不明なローマ字: ${t}`);}
    kana=ROMAJI_KANA[t];text+=kana;
  }
  return {text,unit,kana};
}
export function packPhonetic({sender,seq,type='data',wire=''}){
  if(![0,1].includes(sender)||!Number.isInteger(seq)||seq<1||seq>65534||!['data','ack'].includes(type))throw Error('フレームが不正です。');
  const payload=wire.trim().toUpperCase().replace(/\s+/g,' ');
  if(payload.includes('/')||payload.length>400)throw Error('本文が不正です。');
  const base=`${sender?'B':'A'}${seq}${type==='ack'?'+':'='}`+(payload?' '+payload:'');
  const checksum=crc32(utf8Encode(base)).toString(16).toUpperCase().padStart(8,'0');
  const frame=base+' / '+checksum;encodeText(frame);return frame;
}
export function unpackPhonetic(text,language='ja'){
  const m=/^([AB])(\d{1,5})([=+])(?: ([^/]*?))? \/ ([0-9A-F]{8})$/.exec(text);
  if(!m)throw Error('フレームが不完全です。');
  const [base]=text.split(' / ');
  if(crc32(utf8Encode(base)).toString(16).toUpperCase().padStart(8,'0')!==m[5])throw Error('CRC不一致');
  const wire=(m[4]||'').trim(),type=m[3]==='+'?'ack':'data';
  const result={sender:m[1]==='B'?1:0,seq:Number(m[2]),type,wire,text:language==='ja'?wireToKana(wire).text:wire};
  if(packPhonetic(result)!==text)throw Error('フレーム表現が不正です。');return result;
}
export function phoneticPcm(wire,{wpm=60,sampleRate=48000,frequency=700,volume=.24,acoustic=false}={}){
  const code=encodeText(wire).code,segments=codeToSegments(code,wpm,{experimental:true}),pcm=synthesize(segments,{sampleRate,frequency,volume,experimental:true});
  if(acoustic){const lead=[{on:true,seconds:.25},{on:false,seconds:1.1},...codeToSegments(encodeText('VVV').code,wpm,{experimental:true}).filter((_,i,a)=>i<a.length-1),{on:false,seconds:8*1.2/wpm}],preamble=synthesize(lead,{sampleRate,frequency,volume,experimental:true}),joined=new Float32Array(preamble.length+pcm.length);joined.set(preamble);joined.set(pcm,preamble.length);return {pcm:joined,sampleRate,segments:[...lead,...segments],code,seconds:joined.length/sampleRate};}
  return {pcm,sampleRate,segments,code,seconds:pcm.length/sampleRate};
}
export class PhoneticDecoder {
  constructor({language='ja',wpm=60,frequency=700,threshold=.012,adaptive=false,detection={},onSymbols=()=>{},onHeader=()=>{},onLevel=()=>{},onFrame=()=>{},onCharacter=()=>{},onMark=()=>{},onError=()=>{}}={}){
    this.language=language;
    const framed=text=>adaptive?(text.match(/([AB]\d{1,5}[=+](?: |$).*)/)?.[1]||text):text;
    this.detector=new ToneDetector({...detection,wpm,frequency,sampleRate:48000,experimental:true,threshold,adaptive,onLevel,
      onMessage:m=>{try{if(m.invalid&&!adaptive)throw Error('モールス符号が不正です。');onFrame(unpackPhonetic(framed(m.text),language));}catch(e){onError(e.message,{rawText:m.text,rawCode:m.code});}},
      onUpdate:code=>{
        const raw=decodeCode(code,'international',{strict:false});
        onSymbols({text:raw.text,code,unknown:raw.unknown});
        const complete=framed(decodeCode(code,'international',{strict:false}).text);
        const header=/^([AB])(\d{1,5})([=+])/.exec(complete);
        if(header){const stage=complete.includes(' /')?'checksum':'body',key=header[0]+stage;if(this.lastHeader!==key){this.lastHeader=key;onHeader({sender:header[1]==='B'?1:0,seq:Number(header[2]),type:header[3]==='+'?'ack':'data',stage});}}
        if(adaptive&&/^([AB])(\d{1,5})([=+])(?: ([^/]*?))? \/ ([0-9A-F]{8})$/.test(complete)){
          try{const frame=unpackPhonetic(complete,language);this.detector.decoder.reset();onFrame(frame);return;}catch{}
        }
        const decoded=framed(decodeCode(code,'international',{strict:false}).text),m=/^([AB])(\d{1,5})([=+]) (.*)$/.exec(decoded);
        if(!m)return;
        const closed=m[4].includes('/'),boundary=closed||code.trim().endsWith(' /'),wire=m[4].split('/')[0].trim();let result;
        const key=m[1]+m[2]+m[3]+wire+':'+boundary;if(this.lastProgressKey===key)return;this.lastProgressKey=key;
        try{result=language==='ja'?wireToKana(wire,{partial:!boundary}):{text:wire,unit:wire.slice(-1),kana:''};}catch{return;}
        onCharacter({sender:m[1]==='B'?1:0,seq:Number(m[2]),type:m[3]==='+'?'ack':'data',wire,boundary,...result,morse:[...result.unit].map(c=>INTERNATIONAL[c]||'').join(' ')});
      },onError});
    const pulse=this.detector.decoder,feed=pulse.feed.bind(pulse);let state=false,ms=0;
    pulse.feed=(on,dt)=>{if(on!==state){if(ms)onMark({on:state,units:ms/(1200/wpm)});state=on;ms=0;}ms+=dt;const wasWordDone=pulse.wordDone;feed(on,dt);if(!wasWordDone&&pulse.wordDone&&pulse.active)pulse.onUpdate(pulse.tokens.join(' '));};
  }
  push(pcm){this.detector.push(pcm);}
}
