import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTiming} from '../app/core/morse.mjs';
import {phoneticPcm,packPhonetic} from '../app/core/phonetic-morse.mjs';
import {AcousticReceiver} from '../app/core/acoustic-receiver.mjs';

test('High frequency requires explicit opt-in and stays strictly below Nyquist',()=>{
 assert.throws(()=>validateTiming({frequency:18000,experimental:true}));
 assert.throws(()=>validateTiming({frequency:22001,experimental:true,highFrequency:true}));
 assert.throws(()=>validateTiming({frequency:22000,experimental:true,highFrequency:true,sampleRate:44000}));
 assert.throws(()=>validateTiming({frequency:18000,experimental:true,highFrequency:true,sampleRate:32000}));
 assert.doesNotThrow(()=>validateTiming({frequency:22000,experimental:true,highFrequency:true,sampleRate:44100}));
});
for(const sampleRate of [44100,48000])for(const frequency of [1800,18000,19000,20000,21000,22000]){
 for(const [name,volume,noise,offset] of [['clean',.16,0,0],['attenuated-noisy-offset',frequency>4000?.0008:.032,frequency>4000?.00004:.003,15]]){
  test(`${sampleRate} Hz / ${frequency} Hz ${name}: data + voiced ACK, full symbols, no duplicate or corrupt delivery`,()=>{
   const frames=[],symbols=[];
   const options={wpm:20,sampleRate,frequency,highFrequency:frequency>4000,acoustic:true,volume};
   const receiver=new AcousticReceiver({...options,onFrame:f=>frames.push(f),onSymbols:e=>symbols.push(e.text)});
   let seed=42;
   for(const type of ['data','ack']){
    const wire=packPhonetic({sender:type==='data'?0:1,seq:1,type,wire:type==='data'?'NA WA':'JU SHI N SHI MA SHI TA'});
    const {pcm}=phoneticPcm(wire,{...options,frequency:frequency+(frequency===22000?-offset:offset)});
    if(noise)for(let i=0;i<pcm.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pcm[i]+=noise*(seed/2**31-1);}
    receiver.push(pcm);
   }
   assert.deepEqual(frames.map(f=>f.text),['なわ','じゅしんしました']);
   assert(symbols.some(s=>s.includes('A1=')));assert(symbols.some(s=>s.includes('B1+')));
   const corrupt=packPhonetic({sender:0,seq:2,wire:'NA WA'}).replace('NA WA','KA WA');
   receiver.push(phoneticPcm(corrupt,options).pcm);receiver.push(new Float32Array(sampleRate));
   assert.equal(frames.length,2);
  });
 }
}
test('Sensitive high-frequency detector never delivers background noise as a message',()=>{
 const frames=[];const receiver=new AcousticReceiver({frequency:19000,highFrequency:true,wpm:20,onFrame:f=>frames.push(f)});
 let seed=7;const pcm=new Float32Array(48000*10);
 for(let i=0;i<pcm.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pcm[i]=.003*(seed/2**31-1);}
 receiver.push(pcm);assert.equal(frames.length,0);
});
