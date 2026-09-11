import { ToneDetector } from '../core/dsp.mjs';
class MorseInputProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.running=true;this.record=options.processorOptions?.record===true;
    this.batch=new Float32Array(2048);this.count=0;this.samples=0;
    if(!this.record)this.detector=new ToneDetector({
      ...options.processorOptions,sampleRate,
      onMessage:value=>this.port.postMessage({kind:'message',value}),
      onUpdate:value=>this.port.postMessage({kind:'update',value}),
      onLevel:value=>this.port.postMessage({kind:'level',value}),
      onError:value=>this.port.postMessage({kind:'error',value})
    });
    this.port.onmessage=event=>{
      if(event.data?.kind==='stop'){
        if(this.record&&this.count)this.port.postMessage({kind:'pcm',value:this.batch.slice(0,this.count)});
        this.running=false;this.port.postMessage({kind:'stopped'});
      }else if(event.data?.kind==='reset')this.detector?.reset();
    };
  }
  process(inputs,outputs) {
    for(const channel of outputs[0]||[])channel.fill(0); // Never monitor microphone into speaker.
    const input=inputs[0]?.[0];
    if(this.running&&input){
      if(this.record){
        for(let i=0;i<input.length;i++){
          this.batch[this.count++]=input[i];
          if(this.count===this.batch.length){const value=this.batch;this.port.postMessage({kind:'pcm',value},[value.buffer]);this.batch=new Float32Array(2048);this.count=0;}
        }
      }else this.detector.push(input);
    }
    return this.running;
  }
}
registerProcessor('morsetalk-input',MorseInputProcessor);
