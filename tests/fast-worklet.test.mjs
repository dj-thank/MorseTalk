import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {FastMorseDecoder,packFastFrame,fastPcm} from '../app/core/fast-codec.mjs';
const source=fs.readFileSync(new URL('../app/js/fast-worklet.mjs',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
function processor(wpm=1200){
  let Processor;const messages=[];
  class AudioWorkletProcessor{constructor(){this.port={postMessage:m=>messages.push(m),onmessage:null};}}
  vm.runInNewContext(source,{FastMorseDecoder,AudioWorkletProcessor,sampleRate:48000,registerProcessor:(name,cls)=>{assert.equal(name,'morsetalk-fast-input');Processor=cls;}});
  return {p:new Processor({processorOptions:{wpm}}),messages};
}
const frame=packFastFrame({room:'0000',session:0x20260911,sender:0,seq:1,text:'AIと実モールス'});
function feed(p,pcm){let i=0,b=0;const blocks=[1,31,128,137,256,511];while(i<pcm.length){const n=blocks[b++%blocks.length],out=new Float32Array(n).fill(1);assert.equal(p.process([[pcm.subarray(i,i+n)]],[[out]]),true);assert.ok(out.every(x=>x===0));i+=n;}}
test('Actual MT2 worklet processes variable block sizes and silences monitor',()=>{const{p,messages}=processor();feed(p,fastPcm(frame,{wpm:1200}).pcm);const frames=messages.filter(x=>x.kind==='frame');assert.equal(frames.length,1);assert.equal(frames[0].frame.text,'AIと実モールス');});
test('MT2 worklet mute discards own TX and reset accepts next full frame',()=>{const{p,messages}=processor(600),pcm=fastPcm(frame,{wpm:600}).pcm;p.port.onmessage({data:{kind:'mute',value:true}});feed(p,pcm);assert.equal(messages.length,0);p.port.onmessage({data:{kind:'mute',value:false}});feed(p,pcm);assert.equal(messages.filter(x=>x.kind==='frame').length,1);});
test('MT2 worklet stop terminates process and never decodes after stop',()=>{const{p,messages}=processor();p.port.onmessage({data:{kind:'stop'}});const out=new Float32Array(128).fill(1);assert.equal(p.process([[new Float32Array(128)]],[[out]]),false);assert.ok(out.every(x=>x===0));assert.equal(messages.length,0);});
test('MT2 worklet handles temporarily missing input without exception',()=>{const{p}=processor();assert.equal(p.process([],[]),true);assert.equal(p.process([[]],[[]]),true);});
