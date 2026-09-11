import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioEngine,to16kWav} from '../app/js/audio.mjs';
import {parseWav} from '../app/core/wav.mjs';
const turn=()=>new Promise(resolve=>setTimeout(resolve,0));
test('Stop during pending AudioContext opening prevents late oscillator start',async()=>{
 const a=new AudioEngine();let resolve;a.contextReady=()=>new Promise(r=>resolve=r);
 const p=a.play([{on:true,seconds:.1}]);await turn();a.stopPlayback();resolve({});assert.equal(await p,false);assert.equal(a.job,null);assert.equal(a.openingPlayback,false);
});
test('Only one pending playback is permitted',async()=>{
 const a=new AudioEngine();let resolve;a.contextReady=()=>new Promise(r=>resolve=r);
 const p=a.play([{on:true,seconds:.1}]);await turn();await assert.rejects(a.play([{on:true,seconds:.1}]),/送信中/);a.stopPlayback();resolve({});assert.equal(await p,false);
});
test('Failed AudioContext does not permanently lock playback',async()=>{
 const a=new AudioEngine();a.contextReady=async()=>{throw new Error('no output');};await assert.rejects(a.play([{on:true,seconds:.1}]));assert.equal(a.openingPlayback,false);
});
test('Stopping pending keydown cannot produce a stuck tone',async()=>{
 const a=new AudioEngine();let resolve;a.contextReady=()=>new Promise(r=>resolve=r);const p=a.keyDown();a.keyUp();resolve({});await p;assert.equal(a.key,null);
});
test('Stopping a pending microphone closes any stream granted afterwards',async()=>{
 const a=new AudioEngine();let resolve,stopped=0;a.contextReady=async()=>({});a.loadWorklet=async()=>{};
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>new Promise(r=>resolve=r)}}});
 try{const p=a.startInput({},()=>{});await turn();await a.stopInput();resolve({getTracks:()=>[{stop(){stopped++;}}]});await assert.rejects(p,{name:'AbortError'});assert.ok(stopped>=1);assert.equal(a.input,null);assert.equal(a.openingInput,false);}
 finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
});
test('Recorder downsampling remains mono16k PCM and is duration bounded',()=>{
 const wave=to16kWav([new Float32Array(48000).fill(.5)],48000),out=parseWav(wave);assert.equal(out.sampleRate,16000);assert.equal(out.pcm.length,16000);assert.ok(Math.abs(out.pcm[123]-.5)<1e-4);
 assert.throws(()=>to16kWav([new Float32Array(10)],48000));assert.throws(()=>to16kWav([new Float32Array(48000*22)],48000));
});
test('TTS cancelled while waiting for installed voices does not start later',async()=>{
 globalThis.addEventListener=()=>{};
 let voicesReady,spoken=0;globalThis.speechSynthesis={cancel(){},getVoices(){return []},addEventListener(name,callback){voicesReady=callback},removeEventListener(){},speak(){spoken++}};
 const {speak,stopSpeech}=await import('../app/js/voice.mjs');const p=speak('テスト');stopSpeech();voicesReady();await p;assert.equal(spoken,0);
 delete globalThis.speechSynthesis;
});
test('Stop releases the pending playback lock even before context resolves',async()=>{
 const a=new AudioEngine();const resolutions=[];a.contextReady=()=>new Promise(r=>resolutions.push(r));
 const first=a.play([{on:true,seconds:.1}]);await turn();a.stopPlayback();const second=a.play([{on:true,seconds:.1}]);await turn();assert.equal(resolutions.length,2);
 resolutions[0]({});assert.equal(await first,false);assert.ok(a.openingPlayback);a.stopPlayback();resolutions[1]({});assert.equal(await second,false);
});
test('Microphone stop before AudioContext readiness never asks permission afterwards',async()=>{
 const a=new AudioEngine();let resolve,loaded=false;a.contextReady=()=>new Promise(r=>resolve=r);a.loadWorklet=async()=>{loaded=true};
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>{throw new Error('Must not be called')}}}});
 try{const input=a.startInput({},()=>{});await turn();await a.stopInput();resolve({});await assert.rejects(input,{name:'AbortError'});assert.equal(loaded,false);assert.equal(a.openingInput,false);}
 finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
});
test('Active microphone tracks stop synchronously before worker acknowledgement',async()=>{
 const a=new AudioEngine();let stopped=false;const node={port:{postMessage(){}},disconnect(){}};
 a.input={stream:{getTracks:()=>[{stop(){stopped=true},onended:null}]},node,source:{disconnect(){}},mute:{disconnect(){}},onEvent(){}};
 const p=a.stopInput();assert.equal(stopped,true);node.port.onmessage({data:{kind:'stopped'}});await p;assert.equal(a.input,null);
});
