import {validateTiming,durationOf,pcmToWav} from '../core/morse.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
/** The page uses one exclusive microphone owner, and never records while transmitting. */
export class AudioEngine {
  constructor(){this.context=null;this.workletLoaded=false;this.input=null;this.job=null;this.key=null;this.keyGeneration=0;this.inputGeneration=0;this.openingInput=false;this.playGeneration=0;this.openingPlayback=false;}
  async contextReady(){
    if(!this.context||this.context.state==='closed'){
      const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Context)throw new Error('このブラウザはWeb Audioに対応していません。最新のChrome / Edgeで開いてください。');
      this.context=new Context({latencyHint:'interactive'});this.workletLoaded=false;
    }
    if(this.context.state==='suspended')await this.context.resume();
    if(this.context.state!=='running')throw new Error('音声を開始できません。画面をタップしてから再試行してください。');
    return this.context;
  }
  async loadWorklet(ctx){
    if(this.workletLoaded)return;
    if(!ctx.audioWorklet)throw new Error('マイク受信にはlocalhost / HTTPSとAudioWorklet対応ブラウザが必要です。WindowsランチャーまたはAndroidアプリで開いてください。');
    let url;
    if(globalThis.__MORSETALK_WORKLET_SOURCE__)url=URL.createObjectURL(new Blob([globalThis.__MORSETALK_WORKLET_SOURCE__],{type:'text/javascript'}));
    else url=new URL('./rx-worklet.mjs',import.meta.url).href;
    try{await ctx.audioWorklet.addModule(url);this.workletLoaded=true;}finally{if(url.startsWith('blob:'))URL.revokeObjectURL(url);}
  }
  async startInput(options,onEvent){
    if(this.input||this.openingInput)throw new Error('マイクをすでに使用しています。先に停止してください。');
    if(this.job||this.openingPlayback)throw new Error('送信中はマイクを使用できません。');
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('マイクはlocalhost / HTTPSまたはAndroidアプリで利用できます。');
    const generation=++this.inputGeneration;this.openingInput=generation;
    let stream,source,node,mute;
    try{
      const ctx=await this.contextReady();if(generation!==this.inputGeneration)throw new DOMException('キャンセルしました。','AbortError');
      await this.loadWorklet(ctx);if(generation!==this.inputGeneration)throw new DOMException('キャンセルしました。','AbortError');
      stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(generation!==this.inputGeneration){stream.getTracks().forEach(t=>t.stop());throw new DOMException('キャンセルしました。','AbortError');}
      source=ctx.createMediaStreamSource(stream);
      node=new AudioWorkletNode(ctx,'morsetalk-input',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:options});
      mute=ctx.createGain();mute.gain.value=0;
      node.port.onmessage=event=>onEvent(event.data);
      node.onprocessorerror=()=>onEvent({kind:'error',value:'受信処理が停止しました。マイクを停止して再開してください。'});
      source.connect(node);node.connect(mute);mute.connect(ctx.destination);
      this.input={stream,source,node,mute,sampleRate:ctx.sampleRate,onEvent};
      for(const track of stream.getAudioTracks())track.onended=()=>onEvent({kind:'error',value:'マイク接続が終了しました。'});
      return {sampleRate:ctx.sampleRate};
    }catch(error){
      stream?.getTracks().forEach(t=>t.stop());source?.disconnect();node?.disconnect();mute?.disconnect();throw error;
    }finally{if(this.openingInput===generation)this.openingInput=false;}
  }
  async stopInput(){
    ++this.inputGeneration;this.openingInput=false;
    const input=this.input;this.input=null;
    if(!input)return;
    // Release the hardware synchronously, before awaiting worklet flush or a page pause.
    for(const t of input.stream.getTracks()){t.onended=null;t.stop();}
    let resolveStop;
    const stopped=new Promise(resolve=>{resolveStop=resolve;});
    input.node.port.onmessage=event=>{input.onEvent(event.data);if(event.data?.kind==='stopped')resolveStop();};
    input.node.port.postMessage({kind:'stop'});
    await Promise.race([stopped,sleep(150)]);
    input.node.port.onmessage=null;input.source.disconnect();input.node.disconnect();input.mute.disconnect();
  }
  async play(segments,{frequency=700,volume=0.25,onProgress=()=>{}}={}){
    validateTiming({frequency,volume});
    if(this.job||this.openingPlayback)throw new Error('別の音声を送信中です。');
    this.keyUp();const generation=++this.playGeneration;this.openingPlayback=generation;let ctx;
    try{await this.stopInput();if(generation!==this.playGeneration)return false;ctx=await this.contextReady();}finally{if(this.openingPlayback===generation)this.openingPlayback=false;}
    if(generation!==this.playGeneration)return false;
    const duration=durationOf(segments);
    if(!segments.length||duration>600)throw new Error('送信は600秒以内の文章に分けてください。');
    const oscillator=ctx.createOscillator(),gain=ctx.createGain();
    oscillator.frequency.value=frequency;oscillator.type='sine';gain.gain.value=0;
    oscillator.connect(gain);gain.connect(ctx.destination);
    const start=ctx.currentTime+0.06;let t=start;
    gain.gain.setValueAtTime(0,ctx.currentTime);
    for(const segment of segments){
      const end=t+segment.seconds;
      if(segment.on){
        const ramp=Math.min(0.003,segment.seconds/4);
        gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(volume,t+ramp);
        gain.gain.setValueAtTime(volume,end-ramp);gain.gain.linearRampToValueAtTime(0,end);
      }
      t=end;
    }
    return new Promise(resolve=>{
      const job={oscillator,gain,cancelled:false,raf:null,resolve};this.job=job;
      const update=()=>{if(this.job===job){onProgress(Math.max(0,Math.min(1,(ctx.currentTime-start)/duration)));job.raf=requestAnimationFrame(update);}};
      job.finish=completed=>{
        if(job.finished)return;job.finished=true;oscillator.onended=null;
        cancelAnimationFrame(job.raf);oscillator.disconnect();gain.disconnect();
        if(this.job===job)this.job=null;
        onProgress(completed?1:0);resolve(completed);
      };
      oscillator.onended=()=>job.finish(!job.cancelled);
      oscillator.start(start);oscillator.stop(t);update();
    });
  }
  stopPlayback(){
    ++this.playGeneration;this.openingPlayback=false;const job=this.job;if(!job)return;
    job.cancelled=true;
    try{job.gain.gain.cancelScheduledValues(this.context.currentTime);job.gain.gain.setValueAtTime(0,this.context.currentTime);job.oscillator.stop();}catch{}
    job.finish(false);
  }
  async keyDown({frequency=700,volume=0.25}={}){
    validateTiming({frequency,volume});const generation=++this.keyGeneration;
    const ctx=await this.contextReady();if(generation!==this.keyGeneration||this.key)return;
    const oscillator=ctx.createOscillator(),gain=ctx.createGain();
    oscillator.frequency.value=frequency;gain.gain.value=0;
    oscillator.connect(gain);gain.connect(ctx.destination);gain.gain.linearRampToValueAtTime(volume,ctx.currentTime+0.003);oscillator.start();
    this.key={oscillator,gain};
  }
  keyUp(){
    ++this.keyGeneration;const k=this.key;this.key=null;if(!k)return;
    const ctx=this.context;k.gain.gain.cancelScheduledValues(ctx.currentTime);k.gain.gain.setValueAtTime(k.gain.gain.value,ctx.currentTime);k.gain.gain.linearRampToValueAtTime(0,ctx.currentTime+0.003);k.oscillator.onended=()=>{k.oscillator.disconnect();k.gain.disconnect();};k.oscillator.stop(ctx.currentTime+0.004);
  }
  async stopAll(){this.keyUp();this.stopPlayback();await this.stopInput();}
}
/** Area-average downsampling after browser microphone capture. Recording stays bounded at 20 s. */
export function to16kWav(chunks,sourceRate){
  const count=chunks.reduce((n,c)=>n+c.length,0);
  if(count>sourceRate*21||count<sourceRate*0.15)throw new Error('録音は0.15〜20秒にしてください。');
  const all=new Float32Array(count);let pos=0;for(const c of chunks){all.set(c,pos);pos+=c.length;}
  const ratio=sourceRate/16000,output=new Float32Array(Math.floor(count/ratio));
  for(let i=0;i<output.length;i++){
    const begin=i*ratio,end=(i+1)*ratio;let sum=0;
    for(let j=Math.floor(begin);j<Math.ceil(end)&&j<count;j++)sum+=all[j]*Math.max(0,Math.min(end,j+1)-Math.max(begin,j));
    output[i]=sum/ratio;
  }
  return pcmToWav(output,16000);
}
