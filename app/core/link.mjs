/** Half-duplex policy and ACK matching independent of browser/UI clocks. */
import {packFrame,unpackFrame,DuplicateWindow} from './packet.mjs';
export class LinkSession {
  constructor({room='0000',clock=()=>Date.now()}={}){this.room=room;this.clock=clock;this.duplicates=new DuplicateWindow({clock});this.pending=null;}
  begin({id,text,requestAck}) {
    if(this.pending)throw new Error('前の受信確認が終了していません。停止してから送信してください。');
    const wire=packFrame({room:this.room,id,text,requestAck});
    if(requestAck)this.pending={id,room:this.room,text,wire,attempt:1,deadline:Infinity};
    return wire;
  }
  arm(timeoutMs){if(this.pending)this.pending.deadline=this.clock()+timeoutMs;}
  expired(){return !!this.pending && this.clock()>=this.pending.deadline;}
  retry(maxAttempts=2){
    if(!this.pending||!this.expired())return null;
    if(this.pending.attempt>=maxAttempts){const failed=this.pending;this.pending=null;return {failed:true,...failed};}
    this.pending.attempt++;this.pending.deadline=Infinity;return {...this.pending,retry:true};
  }
  cancel(){this.pending=null;}
  receive(wire){
    const f=unpackFrame(wire,{expectedRoom:this.room});
    if(f.ignored)return f;
    if(f.type==='ack'){
      if(this.pending && f.id===this.pending.id && f.room===this.pending.room){const done=this.pending;this.pending=null;return {acknowledged:true,id:f.id,text:done.text};}
      return {ignored:true,reason:'unexpected-ack'};
    }
    const duplicate=this.duplicates.seen(f);
    const ack=f.requestAck?packFrame({type:'ack',room:f.room,id:f.id}):null;
    return {...f,duplicate,ack};
  }
}
