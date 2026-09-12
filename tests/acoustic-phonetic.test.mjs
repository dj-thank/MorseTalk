import test from 'node:test';import assert from 'node:assert/strict';
import {PulseDecoder} from '../app/core/dsp.mjs';
import {encodeText,codeToSegments} from '../app/core/morse.mjs';
import {PhoneticDecoder,phoneticPcm,packPhonetic} from '../app/core/phonetic-morse.mjs';
import {AcousticReceiver} from '../app/core/acoustic-receiver.mjs';
test('A short noise burst inside a letter gap does not merge Z and E',()=>{
 const run=robust=>{const result=[];const d=new PulseDecoder({wpm:20,robust,onMessage:m=>result.push(m.text)});let injected=false;
 for(const s of codeToSegments(encodeText('ZE').code,20)){
   if(!injected&&!s.on&&Math.abs(s.seconds-.18)<.001){d.feed(false,70);d.feed(true,15);d.feed(false,95);injected=true;}
   else{let ms=s.seconds*1000;while(ms>0){const dt=Math.min(100,ms);d.feed(s.on,dt);ms-=dt;}}
 }d.flush();return result.join('');};
 assert.notEqual(run(false),'ZE');assert.equal(run(true),'ZE');
});
test('Multiple detectors emit one delivery and cannot accept a corrupted CRC',()=>{
 const frames=[],wire=packPhonetic({sender:0,seq:1,wire:'HA I'}),opts={wpm:20,frequency:1800,acoustic:true};
 const receiver=new AcousticReceiver({...opts,onFrame:f=>frames.push(f)});
 receiver.push(phoneticPcm(wire,opts).pcm);assert.equal(frames.length,1);assert.equal(frames[0].text,'はい');
 receiver.push(phoneticPcm(wire.replace('HA I','KA I'),opts).pcm);assert.equal(frames.length,1);
 receiver.push(phoneticPcm(wire,opts).pcm);assert.equal(frames.length,2);
});
for(const wpm of [20,40])test(`Acoustic pilot and 1800 Hz decode exactly one CRC frame at ${wpm} WPM`,()=>{
 const frames=[];const wire=packPhonetic({sender:0,seq:1,wire:'SA I ZE N'}),opts={wpm,frequency:1800,acoustic:true};
 const decoder=new PhoneticDecoder({...opts,adaptive:true,onFrame:f=>frames.push(f)});
 decoder.push(phoneticPcm(wire,opts).pcm);
 assert.equal(frames.length,1);assert.equal(frames[0].text,'さいぜん');
});
