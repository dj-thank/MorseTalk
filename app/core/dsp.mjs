/** Fixed-speed streaming detector. Both devices must use the same WPM and tone.
 * CPU bounded: one 5 ms quadrature detector, no FFT/LLM/network. */
import { validateTiming, decodeCode } from './morse.mjs';
export class PulseDecoder {
  constructor({wpm=40,mode='international',onMessage=()=>{},onUpdate=()=>{},onError=()=>{}}={}) {
    this.unit=validateTiming({wpm}).unit*1000;
    this.mode=mode; this.onMessage=onMessage; this.onUpdate=onUpdate;this.onError=onError; this.reset();
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
      if (this.state) {
        if (duration >= this.unit*0.35 && duration<=this.unit*4.6) {
          this.mark += duration < this.unit*2 ? '.' : '-';
          if(this.mark.length>12){this.invalid=true;this.mark='';}
          this.active=true;this.letterDone=false;this.wordDone=false;
        } else if (duration > this.unit*4.6) {this.invalid=true; this.active=true;}
      }
      this.state=on;this.since=this.time;
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
  constructor({sampleRate=48000,frequency=700,wpm=40,mode='international',threshold=0.012,onMessage,onUpdate,onLevel=()=>{},onError}={}) {
    validateTiming({frequency,wpm});
    if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>96000)throw new Error('サンプルレートが不正です。');
    if(!Number.isFinite(threshold)||threshold<0.002||threshold>0.2)throw new Error('感度が不正です。');
    this.sampleRate=sampleRate;this.size=Math.max(32,Math.round(sampleRate*0.005));
    this.buffer=new Float32Array(this.size);this.offset=0;this.onLevel=onLevel;this.threshold=threshold;
    this.sin=new Float32Array(this.size);this.cos=new Float32Array(this.size);
    for(let i=0;i<this.size;i++){const a=2*Math.PI*frequency*i/sampleRate;this.sin[i]=Math.sin(a);this.cos[i]=Math.cos(a);}
    this.on=false;this.candidate=false;this.dwell=0;this.blocks=0;
    this.decoder=new PulseDecoder({wpm,mode,onMessage,onUpdate,onError});
  }
  push(pcm) {
    for(let pos=0;pos<pcm.length;){
      const n=Math.min(pcm.length-pos,this.size-this.offset);
      this.buffer.set(pcm.subarray(pos,pos+n),this.offset); this.offset+=n;pos+=n;
      if(this.offset===this.size){this.analyze();this.offset=0;}
    }
  }
  analyze() {
    let re=0,im=0,energy=0,mean=0;
    for(let i=0;i<this.size;i++)mean+=this.buffer[i];mean/=this.size;
    for(let i=0;i<this.size;i++){const x=this.buffer[i]-mean;re+=x*this.cos[i];im+=x*this.sin[i];energy+=x*x;}
    const amplitude=2*Math.hypot(re,im)/this.size;
    const rms=Math.sqrt(energy/this.size);
    const purity=Math.min(1,amplitude*amplitude/(2*rms*rms+1e-15));
    const detected=amplitude>(this.on?this.threshold*0.65:this.threshold) && purity>(this.on?0.22:0.38);
    if(detected!==this.candidate){this.candidate=detected;this.dwell=1;}else this.dwell++;
    if(this.dwell>=2)this.on=detected;
    this.decoder.feed(this.on,1000*this.size/this.sampleRate);
    if(++this.blocks%10===0)this.onLevel({amplitude,rms,purity,on:this.on});
  }
  flush(){this.decoder.flush();}
  reset(){this.offset=0;this.on=false;this.candidate=false;this.dwell=0;this.decoder.reset();}
}
