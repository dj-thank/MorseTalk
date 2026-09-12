import { fastPcm } from '../core/fast-codec.mjs';
/** Reserve the microphone once, mute decoding during TX, keep it open between turns. */
export class FastAudio {
  constructor(options={}){this.options=options;this.generation=0;this.closed=true;this.job=null;}
  async start(onEvent){
    if(!this.closed)throw new Error('受信は開始済みです。');
    this.closed=false;const generation=++this.generation;let url;this.onEvent=onEvent;
    try{
      const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
      if(!Context||!navigator.mediaDevices?.getUserMedia)throw new Error('マイクにはWindowsランチャーまたはAndroidアプリを使ってください。');
      this.ctx=new Context({latencyHint:'interactive'});await this.ctx.resume();
      if(this.closed||generation!==this.generation)throw new Error('開始をキャンセルしました。');
      if(!this.ctx.audioWorklet)throw new Error('AudioWorkletに対応したChrome / Edge / WebViewが必要です。');
      url=globalThis.__FAST_WORKLET_SOURCE__?URL.createObjectURL(new Blob([globalThis.__FAST_WORKLET_SOURCE__],{type:'text/javascript'})):new URL('./fast-worklet.mjs',import.meta.url).href;
      await this.ctx.audioWorklet.addModule(url);
      if(this.closed||generation!==this.generation)throw new Error('開始をキャンセルしました。');
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(this.closed||generation!==this.generation){stream.getTracks().forEach(t=>t.stop());throw new Error('開始をキャンセルしました。');}
      this.stream=stream;this.source=this.ctx.createMediaStreamSource(stream);
      this.node=new AudioWorkletNode(this.ctx,'morsetalk-fast-input',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],processorOptions:this.options});
      this.mute=this.ctx.createGain();this.mute.gain.value=0;
      this.source.connect(this.node);this.node.connect(this.mute);this.mute.connect(this.ctx.destination);
      this.node.port.onmessage=e=>{if(!this.closed&&generation===this.generation)onEvent(e.data);};
      // A failed processor or revoked microphone must not leave TX awaiting
      // onended forever. Ignore already-queued callbacks from older sessions.
      const fatal=message=>{
        if(this.closed||generation!==this.generation)return;
        this.stop();onEvent({kind:'fatal',message});
      };
      this.node.onprocessorerror=()=>fatal('音響処理が停止しました。');
      for(const track of stream.getTracks())track.onended=()=>fatal('マイクが切断されました。');
      return {sampleRate:this.ctx.sampleRate,baseLatency:this.ctx.baseLatency,outputLatency:this.ctx.outputLatency};
    }catch(e){if(generation===this.generation)this.stop();throw e;}
    finally{if(url?.startsWith('blob:'))URL.revokeObjectURL(url);}
  }
  async transmit(bytes){
    if(this.closed||!this.node)throw new Error('先に受信待機を開始してください。');
    if(this.job)throw new Error('音声送信が重複しました。');
    const generation=this.generation,ctx=this.ctx;
    const {pcm,sampleRate}=fastPcm(bytes,{...this.options,sampleRate:ctx.sampleRate});
    const buffer=ctx.createBuffer(1,pcm.length,sampleRate);buffer.copyToChannel(pcm,0);
    if(this.options.telemetry){try{this.onEvent?.({kind:'tx',bytes:Array.from(bytes),seconds:pcm.length/sampleRate});}catch{}}
    const source=ctx.createBufferSource();source.buffer=buffer;source.connect(ctx.destination);
    this.node.port.postMessage({kind:'mute',value:true});
    await new Promise((resolve,reject)=>{
      let timer;
      const finish=(error)=>{
        clearTimeout(timer);source.onended=null;try{source.disconnect();}catch{}
        if(this.job?.source===source)this.job=null;
        if(!this.closed&&generation===this.generation)this.node.port.postMessage({kind:'mute',value:false});
        error?reject(error):resolve();
      };
      this.job={source,finish};
      source.onended=()=>{timer=setTimeout(()=>finish(),80);};
      try{source.start(ctx.currentTime+.025);}catch(e){finish(e);}
    });
    if(this.closed||generation!==this.generation)throw new Error('送信を停止しました。');
  }
  stop(){
    this.closed=true;++this.generation;
    if(this.job){const job=this.job;try{job.source.stop();}catch{}job.finish(new Error('音声送信を停止しました。'));}
    // Tear down every resource even if one already-terminated node throws.
    const node=this.node;this.node=null;
    if(node){
      node.port.onmessage=null;node.onprocessorerror=null;
      try{node.port.postMessage({kind:'stop'});}catch{}
      try{node.disconnect();}catch{}
    }
    const stream=this.stream;this.stream=null;
    for(const t of stream?.getTracks()||[]){t.onended=null;try{t.stop();}catch{}}
    const source=this.source,mute=this.mute;this.source=null;this.mute=null;
    try{source?.disconnect();}catch{}
    try{mute?.disconnect();}catch{}
    const ctx=this.ctx;this.ctx=null;
    if(ctx&&ctx.state!=='closed'){try{ctx.close().catch(()=>{});}catch{}}
  }
}
