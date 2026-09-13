import { AcousticReceiver as PhoneticDecoder } from '../core/acoustic-receiver.mjs';
class Input extends AudioWorkletProcessor {
  constructor(options){super();this.options={...options.processorOptions,sampleRate:globalThis.sampleRate??options.processorOptions?.sampleRate??48000};this.running=true;this.muted=false;this.reset();this.port.onmessage=({data})=>{if(data.kind==='mute'){this.muted=data.value;this.reset();}if(data.kind==='stop')this.running=false;};}
  reset(){this.decoder=new PhoneticDecoder({...this.options,onCandidateSymbols:this.options.diagnostics?event=>this.port.postMessage({kind:'candidate-symbols',...event}):undefined,onSymbols:event=>this.port.postMessage({kind:'symbols',...event}),onHeader:header=>this.port.postMessage({kind:'header',...header}),onLevel:level=>this.port.postMessage({kind:'level',...level}),onFrame:frame=>this.port.postMessage({kind:'frame',frame}),onCharacter:event=>this.port.postMessage({kind:'character',...event}),onMark:event=>this.port.postMessage({kind:'mark',...event}),onError:(message,observed)=>this.port.postMessage({kind:'invalid',message,...observed})});}
  process(inputs,outputs){for(const channel of outputs[0]||[])channel.fill(0);const input=inputs[0]?.[0];if(this.running&&!this.muted&&input)this.decoder.push(input);return this.running;}
}
registerProcessor('morsetalk-fast-input',Input);
