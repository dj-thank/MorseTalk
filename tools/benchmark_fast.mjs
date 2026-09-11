/** Reproducible synthesized-channel benchmark. No microphone, real model or wall-clock airtime. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {packFastFrame,unpackFastFrame,fastPcm,fastDuration,FastMorseDecoder} from '../app/core/fast-codec.mjs';
import {prepareMessage} from '../app/core/packet.mjs';
import {pcmToWav} from '../app/core/morse.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});
const spec={room:'0000',session:0x20260911,sender:0,seq:1};
const timings=[];for(const text of ['はい','テストを確認してから実装を進めよう。','状態を確認。'.repeat(10)]){
 const bytes=packFastFrame({...spec,text});const old=prepareMessage({text,room:'0000',id:20260911,mode:'packet',wpm:40});
 for(const wpm of [120,300,600,1200]){
  const frames=[],errors=[],a=fastPcm(bytes,{wpm,sampleRate:48000}),d=new FastMorseDecoder({wpm,sampleRate:48000,onFrame:f=>frames.push(f),onError:e=>errors.push(e)});d.push(a.pcm);
  if(frames.length!==1||frames[0].text!==text||errors.length)throw new Error('Clean benchmark round-trip failed');
  timings.push({text,utf8Bytes:new TextEncoder().encode(text).length,wpm,unitMilliseconds:1200/wpm,frameBytes:bytes.length,compressed:unpackFastFrame(bytes).compressed,generatedPcmSeconds:a.seconds,legacy40WpmSeconds:old.seconds,generatedSignalSpeedup:old.seconds/a.seconds,decodeExact:true,ackSeconds:fastDuration(packFastFrame({...spec,type:'ack'}),{wpm})});
  if(text==='はい')fs.writeFileSync(path.join(root,'examples',`mt2-hai-${wpm}wpm.wav`),pcmToWav(a.pcm,a.sampleRate));
 }
}
// Fixed seeds, simple impairments only; not a room/phone validation dataset.
function noise(pcm,snr,seed){let state=seed||1;const rand=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return(state+.5)/4294967296;};const power=pcm.reduce((sum,x)=>sum+x*x,0)/pcm.length,sigma=Math.sqrt(power/10**(snr/10));const a=new Float32Array(pcm.length);for(let i=0;i<a.length;i+=2){const r=Math.sqrt(-2*Math.log(rand())),v=2*Math.PI*rand();a[i]=pcm[i]+sigma*r*Math.cos(v);if(i+1<a.length)a[i+1]=pcm[i+1]+sigma*r*Math.sin(v);}return a;}
function shifted(pcm,ratio){const a=new Float32Array(Math.ceil(pcm.length*ratio));for(let i=0;i<a.length;i++){const k=i/ratio,j=Math.floor(k),f=k-j;a[i]=(pcm[j]||0)*(1-f)+(pcm[j+1]||0)*f;}return a;}
function echo(pcm,delayMs,gain){const n=Math.round(delayMs*48),a=new Float32Array(pcm.length+n+4800);for(let i=0;i<pcm.length;i++){a[i]+=pcm[i];a[i+n]+=pcm[i]*gain;}return a;}
const cases=[['clean',a=>a],['AWGN 30 dB',(a,s)=>noise(a,30,s)],['AWGN 20 dB',(a,s)=>noise(a,20,s)],['AWGN 10 dB',(a,s)=>noise(a,10,s)],['AWGN 0 dB',(a,s)=>noise(a,0,s)],['clock +0.1%',a=>shifted(a,1.001)],['clock -0.1%',a=>shifted(a,.999)],['echo 0.5 ms / 0.25',a=>echo(a,.5,.25)],['echo 4 ms / 0.5',a=>echo(a,4,.5)],['echo 10 ms / 0.7',a=>echo(a,10,.7)],['silence',a=>new Float32Array(a.length)]];
const channel=[];const text='次はテストです。',bytes=packFastFrame({...spec,text});
for(const wpm of [120,300,600,1200])for(const[name,transform]of cases){let accepted=0,wrong=0,errorCount=0;const seeds=[1,2026,911];for(const seed of seeds){const a=fastPcm(bytes,{wpm,sampleRate:48000}),frames=[],errors=[],d=new FastMorseDecoder({wpm,sampleRate:48000,onFrame:f=>frames.push(f),onError:e=>errors.push(e)});const pcm=transform(a.pcm,seed);for(let i=0;i<pcm.length;i+=137)d.push(pcm.subarray(i,i+137));d.push(new Float32Array(4800));if(frames.length===1&&frames[0].text===text)accepted++;wrong+=frames.filter(f=>f.text!==text).length;errorCount+=errors.length;}channel.push({wpm,condition:name,trials:seeds.length,acceptedExactly:accepted,incorrectlyAcceptedFrames:wrong,decoderErrors:errorCount});}
const report={version:'0.2.0',date:'2026-09-11',scope:'SYNTHETIC_PCM_ONLY; no speaker/microphone, actual LLM, device latency or live bandwidth measurement. SNR uses whole-frame RMS including gaps. Trial seeds 1,2026,911. Deterministic cases repeated with same signal.',timings,channel};
fs.writeFileSync(path.join(out,'v02-benchmark.json'),JSON.stringify(report,null,2)+'\n');
console.log('TEXT TIMING (generated waveform only)');for(const r of timings)console.log(JSON.stringify(r));
console.log('SYNTHETIC IMPAIRMENTS (accepted / 3; wrong frames)');for(const r of channel)console.log(`${r.wpm}\t${r.condition}\t${r.acceptedExactly}/3\twrong:${r.incorrectlyAcceptedFrames}`);
if(channel.some(r=>r.incorrectlyAcceptedFrames))process.exitCode=1;
