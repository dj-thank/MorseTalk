import { SignalAudio } from './signal-audio.mjs';

/** Presentation/audio client. Agent memory, inference and PCM decoding live in
 * two server workers. This module never passes decoded text to an LLM or peer.
 */
export class SignalConversation {
  constructor({onFinished=()=>{},onSound=()=>{},volume=.4,wpm=60,maxTurns=0,language='ja',audio=null}={}){
    Object.assign(this,{onFinished,onSound,volume,wpm,maxTurns,language});this.active=false;this.completed=new Set();
    this.sound=audio||new SignalAudio({onState:s=>onSound(s.rms,s.state)});if(!audio)this.sound.configure({volume});
  }
  async start(topic){
    this.active=true;
    try{
      await this.sound.unlock();
      this.ws=new WebSocket(`ws://${location.host}/conversation`);
      this.ws.onopen=()=>{if(!this.active){this.ws.close();return;}this.ws.send(JSON.stringify({kind:'start',consent:true,topic,wpm:this.wpm,maxTurns:this.maxTurns,language:this.language}));};
      this.ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.kind==='session-ended'){if(m.complete)this.completed=new Set([0,1]);this.finish(m.error?Error(m.error):null);}};
      this.ws.onerror=()=>this.finish(Error('接続を確認してください。'));
      this.ws.onclose=()=>{if(this.active)this.finish(Error('会話との接続が切れました。'));};
    }catch(e){this.finish(e);}
  }
  play(event){
    return this.sound.play(event,{wpm:this.wpm});
  }
  setVolume(value){this.volume=value;this.sound.configure({volume:value});}
  finish(error){
    if(!this.active)return;this.active=false;
    this.ws?.close();this.sound.stop();this.onFinished(error);
  }
  stop(){if(this.ws?.readyState===1)this.ws.send(JSON.stringify({kind:'stop'}));this.finish();}
}
