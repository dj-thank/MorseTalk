import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// The VM supplies only the WebAudio host boundary, not any codec or text encoders.
// Recursively link and execute the actual production ESM dependency graph.
test('Actual worklet ESM graph loads and decodes without TextEncoder/TextDecoder',()=>{
  const script=`
import vm from 'node:vm';import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
let Processor;const messages=[];
class AudioWorkletProcessor{constructor(){this.port={postMessage:x=>messages.push(x)};}}
const ctx=vm.createContext({sampleRate:48000,AudioWorkletProcessor,registerProcessor:(n,p)=>{Processor=p;}});
assert.equal(vm.runInContext('typeof TextEncoder',ctx),'undefined');
assert.equal(vm.runInContext('typeof TextDecoder',ctx),'undefined');
const modules=new Map();
async function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const m=new vm.SourceTextModule(await fs.readFile(file,'utf8'),{context:ctx,identifier:file});modules.set(file,m);await m.link((s,p)=>load(path.resolve(path.dirname(p.identifier),s)));return m;}
const main=await load('app/js/fast-worklet.mjs');await main.evaluate();
const codec=modules.get(path.resolve('app/core/fast-codec.mjs')).namespace;
for(const wpm of [120,300,600,1200]){messages.length=0;const p=new Processor({processorOptions:{wpm}});const bytes=codec.packFastFrame({room:'0000',session:0x20260911,sender:0,seq:1,text:'\\ufeff日本語🌏'});const {pcm}=codec.fastPcm(bytes,{wpm});for(let i=0;i<pcm.length;i+=128)p.process([[pcm.subarray(i,i+128)]],[[new Float32Array(128)]]);const got=messages.filter(m=>m.kind==='frame');assert.equal(got.length,1);assert.equal(got[0].frame.text,'\\ufeff日本語🌏');}
console.log('Actual ESM worklet, all four speeds, strict UTF-8: passed');
`;
  const run=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
  assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
});
