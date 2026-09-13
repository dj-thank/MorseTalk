/** Explicit acoustic test harness, loaded only by the two-device test driver.
 * Receiver has no expected message, sender samples or cross-device transport.
 */
import {FastAudio} from './fast-audio.mjs';
import {phoneticPcm,packPhonetic,kanaToWire} from '../core/phonetic-morse.mjs';
import {ReliableMorseLink} from '../core/fast-link.mjs';
import {unpackFastFrame} from '../core/fast-codec.mjs';
import {setAwake} from './voice.mjs';

export async function createSignalProbe({role,frequency,volume=20,wpm=20,session=20260913}){
 if(![0,1].includes(role)||![1800,18000,19000,20000,21000,22000].includes(frequency)||![20,40,60].includes(volume))throw Error('試験設定が不正です');
 const events=[];let closed=false;
 const record=e=>{events.push({t:Date.now(),...e});if(events.length>6000)events.shift();};
 const options={wpm,frequency,highFrequency:frequency>4000,diagnostics:true,volume:volume*.008,sampleRate:48000,acoustic:true};
 const ack=kanaToWire('じゅしんしました');
 const audio=new FastAudio({...options,phonetic:true,workletURL:new URL('./phonetic-worklet.mjs',import.meta.url).href,pcmFactory:(wire,o)=>phoneticPcm(wire,o)});
 const link=new ReliableMorseLink({sender:role,room:'0000',session,continuous:true,ackDelayMs:300,ackTimeoutMs:Math.ceil(phoneticPcm(packPhonetic({sender:role,seq:1,type:'ack',wire:ack.wire}),options).seconds*1000+12000),onEvent:record,
  sendAudio:async bytes=>{const f=unpackFastFrame(bytes),payload=f.type==='ack'?ack:kanaToWire(f.text),wire=packPhonetic({...f,wire:payload.wire});record({kind:'tx',frame:{...f,wire:payload.wire,text:payload.text}});await audio.transmit(wire);record({kind:'tx-end',seq:f.seq,type:f.type});}});
 const info=await audio.start(e=>{
  if(closed||audio.job)return;
  record(e);
  if(e.kind==='frame'){const f={...e.frame,room:'0000',session};link.receive(f.type==='ack'?{...f,text:''}:f).catch(error=>record({kind:'error',message:error.message}));}
 });
 record({kind:'ready',role,frequency,volume,...info});setAwake(true);
 const stop=()=>{if(closed)return;closed=true;link.close();audio.stop();setAwake(false);record({kind:'stopped'});window.removeEventListener('morsetalk-native-pause',stop);window.removeEventListener('pagehide',stop);};
 window.addEventListener('morsetalk-native-pause',stop);window.addEventListener('pagehide',stop);
 return {snapshot:()=>({closed,role,frequency,volume,events:[...events]}),stop,
  pilot:async()=>{record({kind:'pilot-tx'});await audio.transmit('VVV');record({kind:'pilot-end'});},
  send:(text,seq)=>link.send(text,seq)};
}
