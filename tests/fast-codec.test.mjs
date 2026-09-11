import test from 'node:test';
import assert from 'node:assert/strict';
import {packFastFrame,unpackFastFrame,fastWire,parseFastWire,fastPcm,fastDuration,FastMorseDecoder,lzPack,lzUnpack,FAST_PROFILES} from '../app/core/fast-codec.mjs';
const spec={room:'1234',session:0x20260911,sender:0,seq:1};
const texts=['はい','こんにちは。次の計画を確認しましょう。','AI A: What is 2 + 2?','日本語とEnglish🛰️\n文字化けしません。','繰り返しの文章です。'.repeat(10),'x'.repeat(512)];
for(const text of texts)test(`MT2 exact Unicode + wire roundtrip ${text.slice(0,16)}`,()=>{const frame=packFastFrame({...spec,text});assert.equal(unpackFastFrame(frame).text,text);assert.equal(parseFastWire(fastWire(frame)).text,text);});
for(const [name,wpm] of Object.entries(FAST_PROFILES))for(const sampleRate of [16000,44100,48000])test(`real PCM Morse decode ${name} ${sampleRate}`,()=>{
 const text='AIとモールスで会話。',data=packFastFrame({...spec,text}),a=fastPcm(data,{wpm,sampleRate}),frames=[],errors=[];
 const d=new FastMorseDecoder({wpm,sampleRate,onFrame:f=>frames.push(f),onError:e=>errors.push(e)});
 const prefix=new Float32Array(Math.round(sampleRate*.037));d.push(prefix);
 for(let i=0;i<a.pcm.length;i+=137)d.push(a.pcm.subarray(i,i+137));
 assert.deepEqual(errors,[]);assert.equal(frames.length,1);assert.equal(frames[0].text,text);
});
test('CRC rejects every bit flip in header, payload and checksum',()=>{const original=packFastFrame({...spec,text:'壊れた情報をAIに渡さない'});for(let i=0;i<original.length;i++)for(let bit=0;bit<8;bit++){const bad=original.slice();bad[i]^=1<<bit;assert.throws(()=>unpackFastFrame(bad));}});
test('LZ exact, bounded and compression used only when smaller',()=>{let seed=17;for(let n=1;n<=512;n++){const a=Uint8Array.from({length:n},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;});const b=lzPack(a);if(b.length<=512)assert.deepEqual(lzUnpack(b,n),a);}assert.equal(unpackFastFrame(packFastFrame({...spec,text:'はい'})).compressed,false);assert.equal(unpackFastFrame(packFastFrame({...spec,text:'繰り返し'.repeat(40)})).compressed,true);});
test('malformed input constraints',()=>{for(const overrides of [{session:0},{sender:2},{seq:0},{room:'x'},{text:'a'.repeat(513)},{text:'\ud800'},{text:'\udfff'},{text:''},{type:'ack',text:'x'}])assert.throws(()=>packFastFrame({...spec,text:'ok',...overrides}));assert.throws(()=>lzUnpack(new Uint8Array([1,255,255]),5));assert.throws(()=>lzUnpack(new Uint8Array([0,1,2]),1));});
test('ACK roundtrip and no compression for empty payload',()=>{const a=unpackFastFrame(packFastFrame({...spec,type:'ack'}));assert.equal(a.type,'ack');assert.equal(a.text,'');assert.equal(a.compressed,false);});
test('MT2 600 WPM tiny text under two seconds of generated signal',()=>{assert.ok(fastDuration(packFastFrame({...spec,text:'はい'}),{wpm:600})<2);});
// Independent seeds from benchmark_fast.mjs; synthetic AWGN, not a real-room test.
for(const wpm of [120,300,600,1200])for(const seed of [1403,2729,6551,9137])test(`20 dB synthetic noise exact decode ${wpm} seed ${seed}`,()=>{
 const text='通信結果を確認します。',a=fastPcm(packFastFrame({...spec,text}),{wpm,sampleRate:48000});let state=seed;
 const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return(state+.5)/4294967296;};
 const rms=Math.sqrt(a.pcm.reduce((sum,x)=>sum+x*x,0)/a.pcm.length),noisy=new Float32Array(a.pcm.length);
 for(let i=0;i<noisy.length;i++)noisy[i]=a.pcm[i]+rms/10*Math.sqrt(-2*Math.log(rand()))*Math.cos(2*Math.PI*rand());
 const frames=[],d=new FastMorseDecoder({wpm,sampleRate:48000,onFrame:f=>frames.push(f)});d.push(noisy);d.push(new Float32Array(4800));assert.equal(frames.length,1);assert.equal(frames[0].text,text);
});
