import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {ToneDetector} from '../app/core/dsp.mjs';
import {packFrame,unpackFrame} from '../app/core/packet.mjs';
import {encodeText,codeToSegments,synthesize} from '../app/core/morse.mjs';
const source=fs.readFileSync(new URL('../app/js/rx-worklet.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
function processor(options={}){
 let Processor;const messages=[];
 class AudioWorkletProcessor { constructor(){this.port={postMessage:message=>messages.push(message),onmessage:null};} }
 vm.runInNewContext(source,{ToneDetector,AudioWorkletProcessor,Float32Array,sampleRate:48000,registerProcessor:(name,cls)=>{assert.equal(name,'morsetalk-input');Processor=cls;}});
 return {p:new Processor({processorOptions:options}),messages};
}
test('Actual worklet processor implementation decodes packet through 128-sample blocks',()=>{
 const {p,messages}=processor({wpm:40,frequency:700});
 const wire=packFrame({text:'２台で会話',id:1881}),pcm=synthesize(codeToSegments(encodeText(wire).code,40),{sampleRate:48000});
 for(let i=0;i<pcm.length;i+=128){const output=new Float32Array(128).fill(1);p.process([[pcm.subarray(i,i+128)]],[[output]]);assert.ok(output.every(x=>x===0));}
 const result=messages.filter(x=>x.kind==='message');assert.equal(result.length,1);assert.equal(unpackFrame(result[0].value.text).text,'２台で会話');
});
test('Worklet recorder flushes partial batch on stop and produces silence on monitor',()=>{
 const {p,messages}=processor({record:true});const out=new Float32Array(128).fill(1);p.process([[new Float32Array(128).fill(.25)]],[[out]]);assert.ok(out.every(x=>x===0));
 p.port.onmessage({data:{kind:'stop'}});assert.equal(messages[0].kind,'pcm');assert.equal(messages[0].value.length,128);assert.equal(messages[0].value[0],.25);assert.equal(messages[1].kind,'stopped');assert.equal(p.process([[]],[[out]]),false);
});
test('Worklet recorder emits bounded batches rather than unbounded internal audio',()=>{
 const {p,messages}=processor({record:true});for(let i=0;i<40;i++)p.process([[new Float32Array(128)]],[[new Float32Array(128)]]);
 assert.equal(messages.filter(x=>x.kind==='pcm').length,2);assert.equal(p.count,1024);assert.equal(p.batch.length,2048);
});
