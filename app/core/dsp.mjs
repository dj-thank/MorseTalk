/** Fixed-speed streaming detector. Both devices must use the same WPM and tone.
 * CPU bounded: one 5 ms quadrature detector, no FFT/LLM/network. */
import { validateTiming, decodeCode } from './morse.mjs';
export class PulseDecoder {
  constructor({wpm=40,mode='international',onMessage=()=>{},onUpdate=()=>{},onError=()=>{},experimental=false,robust=false}={}) {
    this.unit=validateTiming({wpm,experimental}).unit*1000;
    this.mode=mode;this.robust=robust; this.onMessage=onMessage; this.onUpdate=onUpdate;this.onError=onError; this.reset();
  }
  reset() {this.time=0;this.state=false;this.since=0;this.mark='';this.tokens=[];this.letterDone=true;this.wordDone=true;this.active=false;this.invalid=false;}
  finishLetter() {
    if (!this.mark) return;
    this.tokens.push(this.mark); this.mark=''; this.letterDone=true;
    if (this.tokens.length>1024) {this.onError('受信が長すぎるためリセットしました。');this.reset();return;}
    this.onUpdate(this.tokens.join(' '));
  }
  feed(on, milliseconds) {
    if (!Number.isFinite(milliseconds) || milliseconds<=0 || milliseconds>1000) throw new Error('検出器の時間刻みが不正です。');
    if (on !== this.state) {
      const duration=this.time-this.since;
      let restoredGap=null;
      if (this.state) {
        if(this.robust&&duration<this.unit*.35)restoredGap=this.gapBeforeMark;
        if (duration >= this.unit*0.35 && duration<=this.unit*4.6) {
          this.mark += duration < this.unit*2 ? '.' : '-';
          if(this.mark.length>12){this.invalid=true;this.mark='';}
          this.active=true;this.letterDone=false;this.wordDone=false;
        } else if (duration > this.unit*4.6) {this.invalid=true; this.active=true;}
      }else this.gapBeforeMark=this.since;
      this.state=on;this.since=restoredGap??this.time;
    }
    this.time+=milliseconds;
    if (!on && this.active) {
      const gap=this.time-this.since;
      if (gap>=this.unit*2.05 && !this.letterDone) this.finishLetter();
      if (gap>=this.unit*5.1 && !this.wordDone && this.tokens.length) {
        this.tokens.push('/');this.wordDone=true;
      }
      if (gap>=Math.max(this.unit*15,900)) this.flush();
    }
  }
  flush() {
    this.finishLetter();
    while(this.tokens.at(-1)==='/')this.tokens.pop();
    const code=this.tokens.join(' '), invalid=this.invalid;
    this.tokens=[];this.mark='';this.active=false;this.invalid=false;this.letterDone=true;this.wordDone=true;
    if (code || invalid) {
      const decoded=decodeCode(code,this.mode,{strict:false});
      this.onMessage({code,...decoded,invalid:invalid||decoded.unknown.length>0});
    }
  }
}
export class ToneDetector {
  constructor({sampleRate=48000,frequency=700,wpm=40,mode='international',threshold=0.012,onMessage,onUpdate,onLevel=()=>{},onError,experimental=false,highFrequency=false,adaptive=false,windowMs=null,peakRatio=.12,purityGate=.05,releaseBlocks=1}={}) {
    validateTiming({frequency,wpm,experimental,highFrequency,sampleRate});
    if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>96000)throw new Error('サンプルレートが不正です。');
    if(!Number.isFinite(threshold)||threshold<(highFrequency?.00002:.002)||threshold>0.2)throw new Error('感度が不正です。');
    windowMs??=adaptive?10:5;
    if(!Number.isFinite(windowMs)||windowMs<2||windowMs>20||!Number.isFinite(peakRatio)||peakRatio<0||peakRatio>1||!Number.isFinite(purityGate)||purityGate<0||purityGate>1||![1,2,3,4].includes(releaseBlocks))throw Error('検出条件が不正です。');
    this.peakRatio=peakRatio;this.purityGate=purityGate;this.releaseBlocks=releaseBlocks;
    this.sampleRate=sampleRate;this.size=Math.max(32,Math.round(sampleRate*windowMs/1000));
    this.buffer=new Float32Array(this.size);this.offset=0;this.onLevel=onLevel;this.threshold=threshold;this.adaptive=adaptive;this.peak=0;
    this.sin=new Float32Array(this.size);this.cos=new Float32Array(this.size);
    for(let i=0;i<this.size;i++){const a=2*Math.PI*frequency*i/sampleRate;this.sin[i]=Math.sin(a);this.cos[i]=Math.cos(a);}
    this.on=false;this.candidate=false;this.dwell=0;this.blocks=0;
    this.decoder=new PulseDecoder({wpm,mode,onMessage,onUpdate,onError,experimental,robust:adaptive});
  }
  push(pcm) {
    for(let pos=0;pos<pcm.length;){
      const n=Math.min(pcm.length-pos,this.size-this.offset);
      this.buffer.set(pcm.subarray(pos,pos+n),this.offset); this.offset+=n;pos+=n;
      if(this.offset===this.size){this.analyze();this.offset=0;}
    }
  }
  analyze() {
    let re=0,im=0,energy=0,mean=0,peak=0,clipped=0;
    for(let i=0;i<this.size;i++)mean+=this.buffer[i];mean/=this.size;
    for(let i=0;i<this.size;i++){const value=this.buffer[i],x=value-mean;peak=Math.max(peak,Math.abs(value));if(Math.abs(value)>=.99)clipped++;re+=x*this.cos[i];im+=x*this.sin[i];energy+=x*x;}
    const amplitude=2*Math.hypot(re,im)/this.size;
    const rms=Math.sqrt(energy/this.size);
    const purity=Math.min(1,amplitude*amplitude/(2*rms*rms+1e-15));
    if(this.adaptive)this.peak=Math.max(this.peak*Math.pow(.995,this.size/(this.sampleRate*.005)),purity>.7?amplitude:0);
    const threshold=this.adaptive?Math.max(this.threshold,this.peak*this.peakRatio):this.threshold;
    const detected=amplitude>(this.on?threshold*0.65:threshold) && purity>(this.adaptive?(this.on?this.purityGate*.7:this.purityGate):(this.on?.22:.38));
    if(detected!==this.candidate){this.candidate=detected;this.dwell=1;}else this.dwell++;
    if(this.dwell>=(this.adaptive&&this.on?this.releaseBlocks:2))this.on=detected;
    this.decoder.feed(this.on,1000*this.size/this.sampleRate);
    this.measuredPeak=Math.max(this.measuredPeak||0,peak);this.clippedSamples=(this.clippedSamples||0)+clipped;
    if(++this.blocks%10===0){this.onLevel({amplitude,rms,purity,on:this.on,peak:this.measuredPeak,clippedFraction:this.clippedSamples/(this.size*10)});this.measuredPeak=0;this.clippedSamples=0;}
  }
  flush(){this.decoder.flush();}
  reset(){this.offset=0;this.on=false;this.candidate=false;this.dwell=0;this.decoder.reset();}
}
