import { FastMorseDecoder } from '../core/fast-codec.mjs';
class FastInputProcessor extends AudioWorkletProcessor {
  constructor(options){
    super();this.running=true;this.muted=false;
    this.decoder=new FastMorseDecoder({...options.processorOptions,sampleRate,
      onFrame:frame=>this.port.postMessage({kind:'frame',frame}),
      onError:message=>this.port.postMessage({kind:'error',message}),
      onLevel:level=>this.port.postMessage({kind:'level',level}),
      onMark:mark=>this.port.postMessage({kind:'mark',...mark}),
      onLetter:letter=>this.port.postMessage({kind:'letter',...letter})});
    this.port.onmessage=event=>{
      const d=event.data;
      if(d?.kind==='mute'){this.muted=Boolean(d.value);this.decoder.reset();}
      if(d?.kind==='stop'){this.running=false;this.decoder.reset();}
    };
  }
  process(inputs,outputs){
    for(const channel of outputs[0]||[])channel.fill(0);
    const input=inputs[0]?.[0];if(this.running&&!this.muted&&input)this.decoder.push(input);
    return this.running;
  }
}
registerProcessor('morsetalk-fast-input',FastInputProcessor);
