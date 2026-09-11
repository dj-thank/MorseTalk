import { utf8Encode, utf8Decode } from './utf8.mjs';
/** MT1 is an application protocol over ordinary international Morse; not Wabun. */
import { encodeText, codeToSegments, durationOf } from './morse.mjs';
export const MAX_PAYLOAD_BYTES = 240;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const enc = {encode:utf8Encode}, dec = {decode:utf8Decode};
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let j=0;j<8;j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function base32Encode(bytes) {
  let value=0, bits=0, out='';
  for (const b of bytes) {
    value = ((value << 8) | b) >>> 0; bits += 8;
    while(bits>=5) { bits-=5; out += ALPHABET[(value >>> bits) & 31]; }
    value &= (1 << bits)-1;
  }
  if (bits) out += ALPHABET[(value << (5-bits)) & 31];
  return out;
}
export function base32Decode(s) {
  if (typeof s !== 'string' || !/^[A-Z2-7]+$/.test(s) || s.length > 512 || [1,3,6].includes(s.length%8)) throw new Error('MT1のBase32表現が不正です。');
  let value=0, bits=0; const out=[];
  for (const c of s) {
    value = ((value << 5) | ALPHABET.indexOf(c)) >>> 0; bits += 5;
    if (bits >= 8) { bits-=8; out.push((value >>> bits)&255); }
    value &= (1 << bits)-1;
  }
  if (bits && value !== 0) throw new Error('MT1の末尾ビットが不正です。');
  const bytes = Uint8Array.from(out);
  if (base32Encode(bytes) !== s) throw new Error('MT1のBase32長が不正です。');
  return bytes;
}
export function parseRoom(room) {
  if (typeof room !== 'string' || !/^\d{4}$/.test(room)) throw new Error('相手と同じ4桁の通信コードを入力してください。');
  return Number(room);
}
export function newMessageId() {
  if (!globalThis.crypto?.getRandomValues) throw new Error('安全な乱数機能がありません。localhostまたはHTTPSで開いてください。');
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}
export function packFrame({text='', room='0000', id, type='data', requestAck=false}) {
  const roomNumber=parseRoom(room);
  if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new Error('メッセージIDが不正です。');
  if (!['data','ack'].includes(type)) throw new Error('フレーム種別が不正です。');
  if (typeof text !== 'string') throw new Error('本文は文字列で指定してください。');
  if ([...text].some(c => c.length === 1 && c.charCodeAt(0) >= 0xD800 && c.charCodeAt(0) <= 0xDFFF)) throw new Error('不正なUnicode文字があります。');
  const payload=enc.encode(text);
  if (payload.length > MAX_PAYLOAD_BYTES) throw new Error(`1回の送信は${MAX_PAYLOAD_BYTES}バイトまでです（日本語は目安80文字）。文章を分けてください。`);
  if (type==='data' && !text.trim()) throw new Error('送信する文章を入力してください。');
  if (type==='ack' && (payload.length || requestAck)) throw new Error('ACKに本文・ACK要求は付けられません。');
  const bytes=new Uint8Array(9+payload.length+4), view=new DataView(bytes.buffer);
  bytes[0] = type === 'ack' ? 2 : requestAck ? 5 : 1;
  view.setUint16(1,roomNumber); view.setUint32(3,id); view.setUint16(7,payload.length);
  bytes.set(payload,9); view.setUint32(bytes.length-4,crc32(bytes.subarray(0,bytes.length-4)));
  return `VVV MT1 ${base32Encode(bytes)} KKK`;
}
export function unpackFrame(wire, {expectedRoom}={}) {
  if (typeof wire !== 'string' || wire.length > 1024) throw new Error('受信フレームが長すぎます。');
  const match = /^VVV MT1 ([A-Z2-7]+) KKK$/.exec(wire.trim().replace(/\s+/g,' '));
  if (!match) throw new Error('端末間フレームが不完全です。方式・速度を合わせて再送してください。');
  const bytes=base32Decode(match[1]);
  if (bytes.length<13) throw new Error('受信フレームが短すぎます。');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), len=view.getUint16(7);
  if (len>MAX_PAYLOAD_BYTES || bytes.length!==13+len) throw new Error('受信長が一致しません。再送してください。');
  if (crc32(bytes.subarray(0,bytes.length-4)) !== view.getUint32(bytes.length-4)) throw new Error('誤り検出：受信データが壊れています。読み上げずに破棄しました。');
  if (![1,2,5].includes(bytes[0])) throw new Error('未対応のフレーム種別です。');
  const roomNumber=view.getUint16(1);
  if (roomNumber>9999) throw new Error('通信コードが不正です。');
  const room=String(roomNumber).padStart(4,'0');
  if (expectedRoom !== undefined && (parseRoom(expectedRoom),room!==expectedRoom)) return {ignored:true, reason:'other-room'};
  const text=dec.decode(bytes.subarray(9,9+len)), type=bytes[0]===2?'ack':'data';
  if ((type==='ack' && len!==0) || (type==='data' && !text.trim())) throw new Error('フレーム本文が不正です。');
  return {type,room,id:view.getUint32(3),text,requestAck:bytes[0]===5,ignored:false};
}
export function prepareMessage({text,mode='packet',room='0000',id=0,requestAck=false,wpm=40}) {
  if (mode==='packet') {
    const wire=packFrame({text,room,id,requestAck});
    const {code}=encodeText(wire); const segments=codeToSegments(code,wpm);
    return {wire,code,segments,seconds:durationOf(segments),normalized:text,bytes:enc.encode(text).length};
  }
  const {code,normalized}=encodeText(text,mode);
  if (!code) throw new Error('送信する文章を入力してください。');
  if (code.length>4096) throw new Error('符号が長すぎます。短い文章に分けてください。');
  const segments=codeToSegments(code,wpm);
  return {wire:normalized,code,normalized,segments,seconds:durationOf(segments),bytes:enc.encode(text).length};
}
/** Bounded duplicate memory; only remember CRC-valid data, never incoming ACKs. */
export class DuplicateWindow {
  constructor({capacity=128,ttlMs=600000,clock=()=>Date.now()}={}) {this.capacity=capacity;this.ttlMs=ttlMs;this.clock=clock;this.entries=new Map();}
  seen(frame) {
    const now=this.clock();
    for (const [key,at] of this.entries) if (now-at>this.ttlMs) this.entries.delete(key);
    const key=`${frame.room}:${frame.id}:${frame.text}`;
    if (this.entries.has(key)) return true;
    this.entries.set(key,now);
    while(this.entries.size>this.capacity) this.entries.delete(this.entries.keys().next().value);
    return false;
  }
  clear(){this.entries.clear();}
}
