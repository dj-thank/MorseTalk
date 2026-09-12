import {PhoneticDecoder} from './phonetic-morse.mjs';

// Different microphone envelopes need different edge thresholds. Every branch
// decodes the SAME received PCM and must independently pass the on-air CRC.
// No expected text, language-model output, or sender PCM is available here.
export class AcousticReceiver {
  constructor(options={}){
    this.samples=0;this.seen=new Map();this.progressProfiles=new Map();
    const profiles=[
      {windowMs:10,peakRatio:.12,purityGate:.05,releaseBlocks:1,threshold:.004},
      {windowMs:5,peakRatio:.08,purityGate:.65,releaseBlocks:2,threshold:.006},
      {windowMs:8,peakRatio:.14,purityGate:.05,releaseBlocks:1,threshold:.004},
      {windowMs:10,peakRatio:0,purityGate:.05,releaseBlocks:1,threshold:.012},
      {windowMs:5,peakRatio:0,purityGate:.2,releaseBlocks:2,threshold:.02},
      {windowMs:10,peakRatio:.04,purityGate:0,releaseBlocks:1,threshold:.004},
    ];
    this.decoders=profiles.map((profile,index)=>new PhoneticDecoder({...options,adaptive:true,threshold:profile.threshold,detection:profile,
      onHeader:header=>{const messageKey=`${header.sender}:${header.seq}:${header.type}`,choice=this.progressProfiles.get(messageKey);if(header.stage==='body'&&(!choice||this.samples-choice.at>96000)){this.progressProfiles.set(messageKey,{index,at:this.samples});while(this.progressProfiles.size>64)this.progressProfiles.delete(this.progressProfiles.keys().next().value);}const key=JSON.stringify(header);if(this.headerKey!==key){this.headerKey=key;options.onHeader?.(header);}},
      onCharacter:character=>{const key=`${character.sender}:${character.seq}:${character.type}`;if(this.progressProfiles.get(key)?.index===index)options.onCharacter?.(character);},
      onMark:index===0?options.onMark:()=>{},onLevel:index===0?options.onLevel:()=>{},onError:index===0?(message,observed)=>options.onError?.(message,{...observed,candidate:true,decoderProfile:index}):()=>{},
      onFrame:frame=>{
        const key=JSON.stringify([frame.sender,frame.seq,frame.type,frame.wire]),last=this.seen.get(key);
        if(last!==undefined&&this.samples-last<96000)return;
        this.seen.set(key,this.samples);while(this.seen.size>64)this.seen.delete(this.seen.keys().next().value);
        options.onFrame?.({...frame,decoderProfile:index});
      }}));
  }
  push(pcm){for(let offset=0;offset<pcm.length;offset+=128){const chunk=pcm.subarray(offset,offset+128);this.samples+=chunk.length;for(const decoder of this.decoders)decoder.push(chunk);}}
}
