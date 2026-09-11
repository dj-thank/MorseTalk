import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeText,codeToSegments,synthesize} from '../app/core/morse.mjs';
import {ToneDetector,PulseDecoder} from '../app/core/dsp.mjs';
import {packFrame,unpackFrame} from '../app/core/packet.mjs';
const decode=(pcm,options={})=>{const results=[];const detector=new ToneDetector({...options,onMessage:x=>results.push(x)});for(let i=0;i<pcm.length;i+=127)detector.push(pcm.subarray(i,i+127));return results;};
function seeded(seed=1234){let x=seed;return()=>{x=(1664525*x+1013904223)>>>0;return x/4294967296;};}
function noise(pcm,std,seed=99){const out=pcm.slice(),rng=seeded(seed);for(let i=0;i<out.length;i++){const n=Math.sqrt(-2*Math.log(Math.max(1e-12,rng())))*Math.cos(2*Math.PI*rng());out[i]+=n*std;}return out;}
for(const sampleRate of [8000,16000,44100,48000])for(const wpm of [8,12,20,30,40,50,60])test(`PCM→SOS PARIS ${sampleRate}Hz ${wpm}WPM`,()=>{
 const pcm=synthesize(codeToSegments(encodeText('SOS PARIS').code,wpm),{sampleRate});const r=decode(pcm,{sampleRate,wpm});assert.equal(r.length,1);assert.equal(r[0].text,'SOS PARIS');assert.equal(r[0].invalid,false);
});
for(const frequency of [400,550,700,900,1200])test(`Carrier ${frequency}Hz`,()=>{const pcm=synthesize(codeToSegments(encodeText('TEST 123').code,40),{sampleRate:48000,frequency});assert.equal(decode(pcm,{sampleRate:48000,wpm:40,frequency})[0]?.text,'TEST 123');});
for(const noiseLevel of [0.01,0.03,0.06,0.1])test(`Noise std ${noiseLevel}`,()=>{const pcm=synthesize(codeToSegments(encodeText('TEST 123').code,30),{sampleRate:16000,volume:0.2});const r=decode(noise(pcm,noiseLevel),{sampleRate:16000,wpm:30});assert.equal(r[0]?.text,'TEST 123');});
for(const delta of [-35,-20,20,35])test(`Frequency mismatch ${delta}Hz`,()=>{const pcm=synthesize(codeToSegments(encodeText('HELLO').code,40),{sampleRate:16000,frequency:700+delta});assert.equal(decode(pcm,{sampleRate:16000,wpm:40})[0]?.text,'HELLO');});
for(const scale of [0.9,1.1])test(`Clock drift ${(scale-1)*100}%`,()=>{const seg=codeToSegments(encodeText('MORSE TEST').code,30).map(s=>({...s,seconds:s.seconds*scale}));const pcm=synthesize(seg,{sampleRate:16000});assert.equal(decode(pcm,{sampleRate:16000,wpm:30})[0]?.text,'MORSE TEST');});
test('Timing jitter ±10%',()=>{const rng=seeded(108);const seg=codeToSegments(encodeText('MORSE TEST').code,30).map(s=>({...s,seconds:s.seconds*(0.9+rng()*0.2)}));assert.equal(decode(synthesize(seg,{sampleRate:16000}),{sampleRate:16000,wpm:30})[0]?.text,'MORSE TEST');});
test('Complete Japanese packet PCM roundtrip with Gaussian noise',()=>{const wire=packFrame({text:'こんにちは🙂',room:'1234',id:42});const pcm=noise(synthesize(codeToSegments(encodeText(wire).code,40),{sampleRate:16000,volume:0.2}),0.04);const r=decode(pcm,{sampleRate:16000,wpm:40});assert.equal(r.length,1);assert.equal(unpackFrame(r[0].text).text,'こんにちは🙂');});
test('Kana Morse PCM roundtrip',()=>{const code=encodeText('こんにちは パンダ','wabun').code;const pcm=synthesize(codeToSegments(code,20),{sampleRate:16000});assert.equal(decode(pcm,{sampleRate:16000,wpm:20,mode:'wabun'})[0]?.text,'コンニチハ パンダ');});
test('Silence and off-frequency tone do not generate messages',()=>{assert.deepEqual(decode(new Float32Array(16000*3),{sampleRate:16000}),[]);const pcm=synthesize(codeToSegments(encodeText('TEST').code,30),{sampleRate:16000,frequency:1200});assert.deepEqual(decode(pcm,{sampleRate:16000,wpm:30,frequency:500}),[]);});
test('White noise does not produce an accepted packet',()=>{const r=decode(noise(new Float32Array(16000*5),0.1),{sampleRate:16000});for(const x of r)assert.throws(()=>unpackFrame(x.text));});
test('Stuck tone flagged, never accepted as a valid character',()=>{const results=[];const d=new PulseDecoder({wpm:40,onMessage:x=>results.push(x)});for(let i=0;i<500;i++)d.feed(true,5);for(let i=0;i<500;i++)d.feed(false,5);assert.equal(results[0]?.invalid,true);});
test('Two transmissions separated by silence are independent',()=>{const pcm=synthesize(codeToSegments(encodeText('HELLO').code,40),{sampleRate:16000});const both=new Float32Array(pcm.length*2);both.set(pcm);both.set(pcm,pcm.length);assert.deepEqual(decode(both,{sampleRate:16000,wpm:40}).map(r=>r.text),['HELLO','HELLO']);});
