import { utf8Encode, utf8Decode } from './utf8.mjs';
/** MT2: reversible UTF-8 packets carried by actual International Morse, not FSK.
 * Wire timing remains dot=1, dash=3, element gap=1, letter gap=3.
 * This machine-only mode is deliberately separate from the original MT1 UI.
 */
import { INTERNATIONAL } from './morse.mjs';
import { crc32, base32Encode, parseRoom } from './packet.mjs';
export const FAST_VERSION = '0.2.1';
export const FAST_PROFILES = Object.freeze({ air:60, cautious:120, balanced:300, fast:600, laboratory:1200 });
export const MAX_FAST_BYTES = 512;
const enc={encode:utf8Encode}, dec={decode:utf8Decode};
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const reverse=new Map(Object.entries(INTERNATIONAL).map(([k,v])=>[v,k]));
function integer(x,min,max,name){if(!Number.isInteger(x)||x<min||x>max)throw new Error(`${name}が範囲外です。`);return x;}
/** Small bounded LZSS. Exact byte copies only; no semantic shortening or lossy translation. */
export function lzPack(input){
  if(!(input instanceof Uint8Array)||input.length>MAX_FAST_BYTES)throw new Error('圧縮入力が不正です。');
  const out=[];let p=0;
  while(p<input.length){
    const flagAt=out.length;out.push(0);let flags=0;
    for(let bit=0;bit<8&&p<input.length;bit++){
      let best=0,distance=0;
      for(let q=p-1;q>=Math.max(0,p-4096);q--){
        let n=0;while(n<18&&p+n<input.length&&input[q+n]===input[p+n])n++;
        if(n>best){best=n;distance=p-q;if(n===18)break;}
      }
      if(best>=3){flags|=1<<bit;const token=((distance-1)<<4)|(best-3);out.push(token>>>8,token&255);p+=best;}
      else out.push(input[p++]);
    }
    out[flagAt]=flags;
  }
  return Uint8Array.from(out);
}
export function lzUnpack(input,expected){
  integer(expected,1,MAX_FAST_BYTES,'復元長');
  if(!(input instanceof Uint8Array)||input.length>MAX_FAST_BYTES)throw new Error('圧縮データが不正です。');
  const out=new Uint8Array(expected);let p=0,o=0;
  while(p<input.length&&o<expected){
    const flags=input[p++];let bit=0;
    for(;bit<8&&o<expected;bit++){
      if(p>=input.length)throw new Error('圧縮データが途切れています。');
      if(flags&(1<<bit)){
        if(p+1>=input.length)throw new Error('参照が途切れています。');
        const t=(input[p++]<<8)|input[p++],d=(t>>>4)+1,n=(t&15)+3;
        if(d>o||o+n>expected)throw new Error('不正な圧縮参照です。');
        for(let j=0;j<n;j++){out[o]=out[o-d];o++;}
      }else out[o++]=input[p++];
    }
    if(bit<8&&(flags>>>bit))throw new Error('未使用フラグが不正です。');
  }
  if(o!==expected||p!==input.length)throw new Error('復元長が一致しません。');
  return out;
}
export function packFastFrame({text='',room='0000',session,sender,seq,type='data',compress=true}){
  const roomNumber=parseRoom(room);
  integer(session,1,0xffffffff,'セッション');integer(sender,0,1,'端末ID');integer(seq,1,65535,'連番');
  if(type!=='data'&&type!=='ack')throw new Error('フレーム種別が不正です。');
  if(typeof text!=='string'||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text))throw new Error('不正なUnicodeです。');
  const raw=enc.encode(text);
  if(raw.length>MAX_FAST_BYTES)throw new Error(`MT2本文は${MAX_FAST_BYTES} UTF-8バイト以内です。`);
  if(type==='data'&&!text.trim())throw new Error('本文が空です。');
  if(type==='ack'&&raw.length)throw new Error('ACKに本文は付けられません。');
  const zipped=compress&&raw.length?lzPack(raw):raw,packed=zipped.length<raw.length,payload=packed?zipped:raw;
  const bytes=new Uint8Array(20+payload.length),v=new DataView(bytes.buffer);
  bytes[0]=0x4d;bytes[1]=0x32;bytes[2]=(type==='ack'?1:0)|(packed?4:0);
  v.setUint16(3,roomNumber);v.setUint32(5,session);bytes[9]=sender;v.setUint16(10,seq);
  v.setUint16(12,payload.length);v.setUint16(14,raw.length);bytes.set(payload,16);
  v.setUint32(bytes.length-4,crc32(bytes.subarray(0,bytes.length-4)));
  return bytes;
}
export function unpackFastFrame(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<20||bytes.length>20+MAX_FAST_BYTES)throw new Error('MT2フレーム長が不正です。');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),length=v.getUint16(12),rawLength=v.getUint16(14);
  if(bytes[0]!==0x4d||bytes[1]!==0x32||![0,1,4].includes(bytes[2]))throw new Error('MT2ヘッダーが不正です。');
  if(length+20!==bytes.length||rawLength>MAX_FAST_BYTES)throw new Error('MT2データ長が不正です。');
  if(v.getUint32(bytes.length-4)!==crc32(bytes.subarray(0,bytes.length-4)))throw new Error('CRC不一致：壊れた受信はAIへ渡しません。');
  const roomNumber=v.getUint16(3),session=v.getUint32(5),sender=bytes[9],seq=v.getUint16(10);
  integer(roomNumber,0,9999,'通信コード');integer(session,1,0xffffffff,'セッション');integer(sender,0,1,'端末ID');integer(seq,1,65535,'連番');
  const type=bytes[2]&1?'ack':'data',compressed=Boolean(bytes[2]&4),payload=bytes.subarray(16,bytes.length-4);
  if(!compressed&&length!==rawLength)throw new Error('非圧縮長が不正です。');
  const raw=compressed?lzUnpack(payload,rawLength):payload,text=dec.decode(raw);
  if((type==='ack'&&rawLength)||(type==='data'&&!text.trim()))throw new Error('MT2本文が不正です。');
  return {type,text,room:String(roomNumber).padStart(4,'0'),session,sender,seq,compressed,rawBytes:rawLength,wireBytes:bytes.length};
}
export function fastWire(bytes){unpackFastFrame(bytes);return 'VV'+base32Encode(bytes);}
export function parseFastWire(wire){
  if(typeof wire!=='string'||!/^VV[A-Z2-7]{32,852}$/.test(wire))throw new Error('MT2符号列が不完全です。');
  const s=wire.slice(2);let value=0,bits=0;const out=[];
  for(const c of s){value=(value<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bits-=8;out.push((value>>>bits)&255);}value&=(1<<bits)-1;}
  const bytes=Uint8Array.from(out);
  if(value||base32Encode(bytes)!==s)throw new Error('MT2 Base32の末尾が不正です。');
  return unpackFastFrame(bytes);
}
export function fastTiming({wpm=300,frequency=4000,sampleRate=48000,volume=.18}={}){
  if(!Object.values(FAST_PROFILES).includes(wpm))throw new Error('MT2速度は60 / 120 / 300 / 600 / 1200 WPMです。');
  integer(sampleRate,16000,96000,'サンプルレート');
  if(!Number.isFinite(frequency)||frequency<2500||frequency>5000||frequency>=sampleRate/2)throw new Error('MT2搬送波は2500〜5000 Hzです。');
  if(!Number.isFinite(volume)||volume<0||volume>.5)throw new Error('MT2音量は0〜0.5です。');
  if(frequency*1.2/wpm<3)throw new Error('1短点に最低3周期が必要です。');
  return {wpm,frequency,sampleRate,volume,unit:1.2/wpm};
}
export function fastSegments(wire,{wpm=300}={}){
  const {unit}=fastTiming({wpm});
  if(typeof wire!=='string'||!/^VV[A-Z2-7]{32,852}$/.test(wire))throw new Error('MT2送信符号が不正です。');
  const result=[{on:false,seconds:.04}];
  [...wire].forEach((ch,ci)=>{
    if(ci)result.push({on:false,seconds:3*unit});
    [...INTERNATIONAL[ch]].forEach((mark,mi)=>{if(mi)result.push({on:false,seconds:unit});result.push({on:true,seconds:(mark==='.'?1:3)*unit});});
  });
  result.push({on:false,seconds:Math.max(.02,12*unit)});
  return result;
}
export function fastDuration(bytes,options={}){return fastSegments(fastWire(bytes),options).reduce((n,s)=>n+s.seconds,0);}
export function fastPcm(bytes,options={}){
  const t=fastTiming(options),segments=fastSegments(fastWire(bytes),t),seconds=segments.reduce((n,s)=>n+s.seconds,0);
  if(seconds>150)throw new Error('MT2送信が長すぎます。文章を短くしてください。');
  const pcm=new Float32Array(Math.ceil(seconds*t.sampleRate));let pos=0;
  for(const s of segments){
    const begin=Math.round(pos*t.sampleRate);pos+=s.seconds;const end=Math.min(pcm.length,Math.round(pos*t.sampleRate));
    if(!s.on)continue;
    const ramp=Math.max(1,Math.min(Math.round(t.sampleRate*.00015),Math.floor((end-begin)/8)));
    for(let i=begin;i<end;i++){const envelope=Math.max(0,Math.min(1,(i-begin)/ramp,(end-1-i)/ramp));pcm[i]=t.volume*envelope*Math.sin(2*Math.PI*t.frequency*i/t.sampleRate);}
  }
  return {pcm,sampleRate:t.sampleRate,seconds:pcm.length/t.sampleRate};
}
/** Streaming coherent envelope detector. Worklet block size is irrelevant; samples are accumulated.
 * No speech recognition, timers for individual dits, or fixed 1.1-second idle delimiter.
 */
export class FastMorseDecoder {
  constructor({wpm=300,frequency=4000,sampleRate=48000,onFrame=()=>{},onError=()=>{},onLevel=()=>{}}={}){
    Object.assign(this,fastTiming({wpm,frequency,sampleRate}));Object.assign(this,{onFrame,onError,onLevel});
    this.window=Math.max(Math.ceil(sampleRate/frequency),Math.round(sampleRate*this.unit/2));
    this.hop=Math.max(1,Math.round(sampleRate*this.unit/16));
    this.cosStep=Math.cos(2*Math.PI*frequency/sampleRate);this.sinStep=Math.sin(2*Math.PI*frequency/sampleRate);
    this.reset();
  }
  reset(){this.iqI=new Float64Array(this.window);this.iqQ=new Float64Array(this.window);this.index=0;this.sumI=0;this.sumQ=0;this.oscC=1;this.oscS=0;this.samples=0;this.peak=.02;this.high=false;this.runStart=0;this.mark='';this.wire='';this.prefix='';this.acquired=false;this.boundary=false;this.invalid=false;this.levelSamples=0;}
  finishLetter(){
    if(!this.mark)return;
    const c=reverse.get(this.mark);this.mark='';
    if(!c||!/[A-Z2-7]/.test(c)){if(this.acquired)this.invalid=true;else this.prefix='';return;}
    if(!this.acquired){
      this.prefix=(this.prefix+c).slice(-2);
      if(this.prefix==='VV'){this.acquired=true;this.wire='VV';this.invalid=false;}
      return;
    }
    this.wire+=c;if(this.wire.length>854){this.invalid=true;this.wire='';}
  }
  finishFrame(){
    this.finishLetter();
    if(this.wire&&!this.invalid){try{const frame=parseFastWire(this.wire);this.onFrame(frame);}catch(e){this.onError(e.message);}}
    else if(this.invalid)this.onError('MT2受信タイミング不一致。速度・音量・反響を確認してください。');
    this.wire='';this.mark='';this.prefix='';this.acquired=false;this.invalid=false;
  }
  push(pcm){
    for(let i=0;i<pcm.length;i++){
      const x=Number.isFinite(pcm[i])?pcm[i]:0,a=x*this.oscC,b=x*this.oscS;
      this.sumI+=a-this.iqI[this.index];this.sumQ+=b-this.iqQ[this.index];this.iqI[this.index]=a;this.iqQ[this.index]=b;this.index=(this.index+1)%this.window;
      const c=this.oscC*this.cosStep-this.oscS*this.sinStep;this.oscS=this.oscS*this.cosStep+this.oscC*this.sinStep;this.oscC=c;this.samples++;
      if(this.samples%this.hop)continue;
      const amplitude=2*Math.hypot(this.sumI,this.sumQ)/this.window,now=this.samples/this.sampleRate;
      this.peak=Math.max(amplitude,this.peak*Math.exp(-this.hop/this.sampleRate));
      const threshold=Math.max(.006,this.peak*.38),high=amplitude>threshold;
      if(this.samples-this.levelSamples>this.sampleRate*.1){this.levelSamples=this.samples;this.onLevel(amplitude);}
      if(high!==this.high){
        const duration=now-this.runStart;
        if(this.high){
          const units=duration/this.unit;
          if(units<.35||units>3.9){if(this.acquired)this.invalid=true;else{this.mark='';this.prefix='';}}
          else this.mark+=units<2?'.':'-';
          if(this.mark.length>6){if(this.acquired)this.invalid=true;else{this.mark='';this.prefix='';}}
        }
        this.high=high;this.runStart=now;this.boundary=false;
      }else if(!high){
        const units=(now-this.runStart)/this.unit;
        if(units>=2&&!this.boundary){this.finishLetter();this.boundary=true;}
        if(units>=9&&(this.wire||this.mark||this.prefix||this.invalid))this.finishFrame();
      }
    }
  }
}
