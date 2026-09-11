/** Versioned invitations and authenticated, end-to-end encrypted Morse symbols.
 * Invitation secrets never appear in relay URLs or diagnostic journals.
 */
import { connectionCode, parseConnectionCode } from './session-tools.mjs';
import { fastWire, parseFastWire } from './fast-codec.mjs';
import { INTERNATIONAL } from './morse.mjs';
export const ONLINE_TTL_MS = 15 * 60 * 1000;
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', {fatal:true});
const reverse = new Map(Object.entries(INTERNATIONAL).map(([c,m])=>[m,c]));
export function toBase64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
export function fromBase64(text, max=16000) {
  if(typeof text!=='string'||!text.length||text.length>max||!/^[A-Za-z0-9_-]+$/.test(text))throw Error('符号形式が不正です。');
  const s=atob(text.replaceAll('-','+').replaceAll('_','/'));const out=Uint8Array.from(s,c=>c.charCodeAt(0));
  if(toBase64(out)!==text)throw Error('符号末尾が不正です。');return out;
}
export function relayURL(text) {
  if(typeof text!=='string'||text.length>240||/[\s\\]/.test(text))throw Error('中継URLを確認してください。');
  let u;try{u=new URL(text);}catch{throw Error('wss:// から始まる中継URLが必要です。');}
  const local=['127.0.0.1','localhost','[::1]'].includes(u.hostname);
  if((u.protocol!=='wss:'&&!(u.protocol==='ws:'&&local))||u.username||u.password||u.search||u.hash||u.pathname!=='/v1')
    throw Error('中継URLは wss://ホスト/v1。平文wsはループバック試験だけに使えます。');
  return u.href;
}
export function validateInvite(value, now=Date.now()) {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='e,k,p,r,v,w'||value.v!==1)throw Error('オンライン招待の形式が違います。');
  if(!Number.isSafeInteger(value.e)||value.e<=now||value.e>now+ONLINE_TTL_MS+5000)throw Error('招待の期限が切れたか、端末時計が合っていません。新しい招待を作成してください。');
  if(fromBase64(value.w,22).length!==16||fromBase64(value.k,43).length!==32)throw Error('招待の鍵が不正です。');
  const p=connectionCode(parseConnectionCode(value.p));
  return Object.freeze({v:1,r:relayURL(value.r),w:value.w,k:value.k,e:value.e,p});
}
export function newInvite(relay, settings, now=Date.now()) {
  return validateInvite({v:1,r:relay,w:toBase64(crypto.getRandomValues(new Uint8Array(16))),k:toBase64(crypto.getRandomValues(new Uint8Array(32))),e:now+ONLINE_TTL_MS,p:connectionCode(settings)},now);
}
export function inviteCode(invite,now=Date.now()) { return 'MTO1.'+toBase64(enc.encode(JSON.stringify(validateInvite(invite,now)))); }
export function parseInvite(text,now=Date.now()) {
  if(typeof text!=='string'||text.length>1400||!text.trim().startsWith('MTO1.'))throw Error('MTO1. から始まる招待を読み込んでください。');
  let value;try{value=JSON.parse(dec.decode(fromBase64(text.trim().slice(5),1350)));}catch{throw Error('招待を読み取れません。');}
  return validateInvite(value,now);
}
export function bytesToMorse(bytes) { return [...fastWire(bytes)].map(c=>INTERNATIONAL[c]).join(' '); }
export function morseToFrame(text) {
  if(typeof text!=='string'||text.length>6200||!/^[-.]{1,6}( [-.]{1,6}){33,853}$/.test(text))throw Error('オンラインのモールス符号列が不正です。');
  const wire=text.split(' ').map(s=>reverse.get(s)||'?').join('');return parseFastWire(wire);
}
export async function channelKeys(invite) {
  const source=await crypto.subtle.importKey('raw',fromBase64(invite.k),'HKDF',false,['deriveKey']);
  const salt=fromBase64(invite.w);
  const keys=await Promise.all([0,1].map(from=>crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:enc.encode('MorseTalk online v1 direction '+from)},source,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])));
  const auth=toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode('MorseTalk relay v1|'+invite.w+'|'+invite.k))));
  return {keys,auth};
}
export async function seal(keys, invite, from, payload) {
  if(from!==0&&from!==1)throw Error('端末IDが不正です。');
  const raw=enc.encode(JSON.stringify(payload));if(raw.length>7200)throw Error('送信が大きすぎます。');
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode('MTO1|'+invite.w+'|'+from),tagLength:128},keys[from],raw);
  return {t:'box',from,iv:toBase64(iv),body:toBase64(new Uint8Array(ciphertext))};
}
export async function openBox(keys,invite,from,box) {
  if(!box||box.t!=='box'||box.from!==from||Object.keys(box).sort().join(',')!=='body,from,iv,t')throw Error('受信封筒が不正です。');
  const iv=fromBase64(box.iv,16);if(iv.length!==12)throw Error('受信nonceが不正です。');
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:enc.encode('MTO1|'+invite.w+'|'+from),tagLength:128},keys[from],fromBase64(box.body,9800));
  return JSON.parse(dec.decode(raw));
}
