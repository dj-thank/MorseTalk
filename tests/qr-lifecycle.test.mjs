import test from 'node:test';
import assert from 'node:assert/strict';
// The module also registers the native-result event; no native bridge is exercised here.
const target=new EventTarget();
globalThis.addEventListener=target.addEventListener.bind(target);
const {QRScanner}=await import('../app/js/pairing-ui.mjs');

function fixture(){
  const busy=[],errors=[],events=[],video={pause(){events.push('pause');},async play(){},srcObject:null};
  const scanner=new QRScanner({video,onBusy:v=>busy.push(v),onResult(){},onError:e=>errors.push(e.message)});
  scanner.read=()=>null;
  const track={onended:null,stop(){events.push('stop');}};
  const stream={getTracks:()=>[track]};
  return {scanner,busy,errors,events,video,track,stream};
}
async function withCamera(fn){
  const old=Object.getOwnPropertyDescriptor(globalThis,'navigator'),f=fixture();
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:async()=>f.stream}}});
  try{await fn(f);}finally{f.scanner.stop();if(old)Object.defineProperty(globalThis,'navigator',old);else delete globalThis.navigator;}
}
test('QR camera stop releases tracks and controls across three sessions',async()=>withCamera(async f=>{
  for(let i=0;i<3;i++){await f.scanner.start();assert.equal(f.scanner.active,true);f.scanner.stop();assert.equal(f.video.srcObject,null);assert.equal(f.scanner.timer,null);assert.equal(f.scanner.active,false);}
  assert.deepEqual(f.busy,[true,false,true,false,true,false]);assert.equal(f.events.filter(x=>x==='stop').length,3);
}));
test('Revoked camera restores controls and reports the interruption once',async()=>withCamera(async f=>{
  await f.scanner.start();const ended=f.track.onended;ended();ended();assert.equal(f.scanner.active,false);assert.equal(f.errors.length,1);assert.deepEqual(f.busy,[true,false]);
}));
test('An old camera callback cannot close a restarted scan',async()=>withCamera(async f=>{
  await f.scanner.start();const old=f.track.onended;f.scanner.stop();await f.scanner.start();old();assert.equal(f.scanner.active,true);assert.equal(f.errors.length,0);
}));
test('Camera cleanup continues if one track or the video element has already failed',()=>{
  const f=fixture(),stopped=[];f.scanner.stream={getTracks:()=>[{stop(){throw Error('gone');}},{stop(){stopped.push(true);}}]};
  f.video.pause=()=>{throw Error('detached');};f.scanner.active=true;
  assert.doesNotThrow(()=>f.scanner.stop());assert.deepEqual(stopped,[true]);assert.deepEqual(f.busy,[false]);assert.equal(f.scanner.stream,null);assert.doesNotThrow(()=>f.scanner.stop());
});
test('Late permission acquisition after stop releases capture without reviving UI',async()=>withCamera(async f=>{
  let resolve;navigator.mediaDevices.getUserMedia=()=>new Promise(r=>resolve=r);const pending=f.scanner.start();f.scanner.stop();resolve(f.stream);await pending;assert.equal(f.scanner.active,false);assert.equal(f.video.srcObject,null);assert.deepEqual(f.busy,[true,false]);assert.ok(f.events.includes('stop'));
}));
