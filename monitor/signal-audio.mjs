import { fastPcm } from '../app/core/fast-codec.mjs';
import { phoneticPcm } from '../app/core/phonetic-morse.mjs';

/** Speaker output belongs to the viewing page, not to the session owner. */
export class SignalAudio {
  constructor({onState=()=>{},AudioContextImpl=globalThis.AudioContext}={}){
    this.onState=onState;this.AudioContextImpl=AudioContextImpl;this.players=new Set();this.volume=.4;this.enabled=true;this.context=null;this.peak=0;
  }
  report(rms=0){this.peak=Math.max(this.peak,rms);this.onState({rms,peak:this.peak,state:this.context?.state||'closed',enabled:this.enabled,volume:this.volume,playing:this.players.size>0});}
  async unlock(){
    if(!this.context||this.context.state==='closed'){
      this.context=new this.AudioContextImpl({sampleRate:48000});this.master=this.context.createGain();this.analyser=this.context.createAnalyser();this.analyser.fftSize=256;
      this.master.connect(this.analyser);this.analyser.connect(this.context.destination);this.context.onstatechange=()=>this.report();
    }
    this.master.gain.setValueAtTime(this.enabled?this.volume:0,this.context.currentTime);
    await this.context.resume();this.report();
    if(this.context.state!=='running')throw Error('音声を再開できませんでした。「音を確認」を押してください。');
  }
  configure({enabled=this.enabled,volume=this.volume}={}){
    this.enabled=enabled;this.volume=Math.max(0,Math.min(1,Number(volume)||0));
    if(this.context&&this.context.state!=='closed')this.master.gain.setTargetAtTime(this.enabled?this.volume:0,this.context.currentTime,.025);
    this.report();
  }
  play(event,{wpm=60}={}){
    if(!this.enabled||!this.volume||this.context?.state!=='running'){this.report();return false;}
    if(!event.wire&&!event.bytes)return false;
    const decoded=event.kind==='phonetic-tx'?phoneticPcm(event.wire,{wpm,frequency:700,sampleRate:48000,volume:.24})
      :fastPcm(Uint8Array.from(event.bytes),{wpm,frequency:2800,sampleRate:48000,volume:.24});
    return this.schedule(decoded,event.audioStart||Date.now(),event.role);
  }
  schedule({pcm,sampleRate},audioStart,role=0){
    const ctx=this.context,late=Math.max(0,(Date.now()-audioStart)/1000),delay=Math.max(0,(audioStart-Date.now())/1000);
    if(ctx?.state!=='running'||late>=pcm.length/sampleRate){this.report();return false;}
    const source=ctx.createBufferSource(),buffer=ctx.createBuffer(1,pcm.length,sampleRate),pan=ctx.createStereoPanner();
    buffer.copyToChannel(pcm,0);source.buffer=buffer;pan.pan.value=role ? .25 : -.25;source.connect(pan);pan.connect(this.master);
    let timer;const meter=new Float32Array(this.analyser.fftSize);
    const cleanup=()=>{clearTimeout(timer);source.disconnect();pan.disconnect();this.players.delete(player);this.report();};
    const player={cancel:()=>{source.onended=null;try{source.stop();}catch{}cleanup();}};this.players.add(player);
    const tick=()=>{this.analyser.getFloatTimeDomainData(meter);this.report(Math.sqrt(meter.reduce((sum,n)=>sum+n*n,0)/meter.length));timer=setTimeout(tick,25);};
    source.onended=cleanup;source.start(ctx.currentTime+delay,late);tick();return true;
  }
  async test(){
    if(!this.volume)throw Error('音量を上げてから「音を確認」を押してください。');
    this.configure({enabled:true});await this.unlock();this.peak=0;
    const sampleRate=48000,pcm=new Float32Array(Math.round(sampleRate*.7));
    for(const [from,to] of [[.03,.15],[.24,.6]])for(let i=Math.round(from*sampleRate);i<to*sampleRate;i++){
      const edge=Math.min(1,(i-from*sampleRate)/(sampleRate*.006),(to*sampleRate-i)/(sampleRate*.006));pcm[i]=.3*Math.max(0,edge)*Math.sin(2*Math.PI*700*i/sampleRate);
    }
    this.schedule({pcm,sampleRate},Date.now()+20);return true;
  }
  stop({close=true}={}){
    for(const player of [...this.players])player.cancel();
    if(close&&this.context&&this.context.state!=='closed')this.context.close().catch(()=>{});this.report();
  }
}
