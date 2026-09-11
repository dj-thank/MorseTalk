/** Bounded half-duplex AI conversation. Remote text is data, never executable code. */
import { packFastFrame, parseFastWire, fastWire } from './fast-codec.mjs';
import { DEFAULT_GOAL, initialTopic, conversationPrompt, conversationMessages, replyIssue, topicMessage } from './conversation.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
export class ReliableMorseLink {
  constructor({room='0000',session,sender,sendAudio,onData=()=>{},onEvent=()=>{},ackDelayMs=220,ackTimeoutMs=4000,maxRetries=1}){
    // Validate configuration using the same encoder as the actual send path.
    packFastFrame({room,session,sender,seq:1,text:'test'});
    if(typeof sendAudio!=='function'||!Number.isFinite(ackDelayMs)||ackDelayMs<0||ackDelayMs>5000||!Number.isFinite(ackTimeoutMs)||ackTimeoutMs<1||ackTimeoutMs>30000||!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>2)throw new Error('リンク設定が不正です。');
    Object.assign(this,{room,session,sender,sendAudio,onData,onEvent,ackDelayMs,ackTimeoutMs,maxRetries});
    this.open=true;this.queue=Promise.resolve();this.pending=null;this.incoming=new Map();this.pendingAcks=new Map();this.nextReceive=sender===0?2:1;this.nextSend=sender===0?1:2;
  }
  event(kind,detail={}){this.onEvent({kind,...detail});}
  enqueue(bytes){
    const run=this.queue.catch(()=>{}).then(async()=>{if(!this.open)throw new Error('リンクは停止しています。');await this.sendAudio(bytes);});
    this.queue=run;return run;
  }
  async send(text,seq){
    if(!this.open)throw new Error('リンクは停止しています。');
    if(this.pending)throw new Error('前の送信が完了していません。');
    if(seq!==this.nextSend)throw new Error('送信ターン順序が不正です。');
    const bytes=packFastFrame({room:this.room,session:this.session,sender:this.sender,seq,text});
    const pending={seq,...deferred()};this.pending=pending;
    try{
      for(let attempt=0;attempt<=this.maxRetries;attempt++){
        this.event('transmit',{seq,attempt,bytes:bytes.length});
        await this.enqueue(bytes);
        let timer;const result=await Promise.race([pending.promise,new Promise(resolve=>{timer=setTimeout(()=>resolve('timeout'),this.ackTimeoutMs);})]);clearTimeout(timer);
        if(result==='ack'){this.nextSend+=2;this.event('delivered',{seq,attempt});return {delivered:true,attempts:attempt+1};}
        if(result==='closed'||!this.open)throw new Error('送信を停止しました。');
        this.event('timeout',{seq,attempt});
      }
      throw new Error('受信確認がありません。両端の設定を合わせ、速度を下げて新しいセッションで再開してください。');
    }finally{if(this.pending===pending)this.pending=null;}
  }
  async receive(frame){
    if(!this.open)return false;
    // Revalidate externally supplied frame objects too; only the canonical codec is trusted.
    try{frame=parseFastWire(fastWire(packFastFrame(frame)));}catch(e){this.event('invalid',{message:e.message});return false;}
    if(frame.room!==this.room||frame.session!==this.session||frame.sender===this.sender){this.event('ignored');return false;}
    if(frame.type==='ack'){
      if(this.pending?.seq===frame.seq)this.pending.resolve('ack');
      return true;
    }
    if(frame.seq%2!==(frame.sender===0?1:0)){this.event('invalid',{message:'端末IDとターン番号が一致しません。'});return false;}
    const known=this.incoming.get(frame.seq);
    if(known!==undefined&&known!==frame.text){this.event('invalid',{message:'同じ連番の内容が異なります。新しいセッションが必要です。'});return false;}
    if(known===undefined&&frame.seq!==this.nextReceive){this.event('invalid',{message:'順序外のデータを破棄しました。'});return false;}
    const duplicate=known!==undefined;
    // Echoes/retransmits must not queue unbounded ACK audio or delay the real reply.
    // Do not advance sequence state for a frame we cannot currently acknowledge.
    if(!this.pendingAcks.has(frame.seq)&&this.pendingAcks.size>=4){
      this.event('invalid',{message:'受信確認キューが混雑しています。再送を待ちます。'});return false;
    }
    if(!duplicate){
      this.incoming.set(frame.seq,frame.text);this.nextReceive+=2;
      while(this.incoming.size>64)this.incoming.delete(this.incoming.keys().next().value);
      // A valid next turn also acknowledges our previous turn (lost standalone ACK).
      if(this.pending?.seq===frame.seq-1)this.pending.resolve('ack');
    }
    this.event(duplicate?'duplicate':'receive',{seq:frame.seq,text:frame.text});
    // Queue the turnaround immediately, so an AI reply can never jump ahead of its ACK.
    const ack=packFastFrame({room:this.room,session:this.session,sender:this.sender,seq:frame.seq,type:'ack'});
    let task=this.pendingAcks.get(frame.seq);
    if(!task){
      const previous=this.queue;
      task=previous.catch(()=>{}).then(async()=>{
        if(!this.open)return;
        await sleep(this.ackDelayMs);if(!this.open)return;
        await this.sendAudio(ack);if(this.open)this.event('ack-sent',{seq:frame.seq});
      }).finally(()=>{this.pendingAcks.delete(frame.seq);});
      this.pendingAcks.set(frame.seq,task);this.queue=task;
    }
    // Inference overlaps ACK turnaround/playback. The transmit queue still guarantees
    // that the ACK completes before any reply audio begins. Yield one task so a
    // piggyback acknowledgement can finish the previous application send first.
    const application=!duplicate?sleep(0).then(()=>{if(this.open)return this.onData(frame);}):Promise.resolve();
    try{
      await Promise.all([task,application]);
      return true;
    }catch(e){this.event('error',{message:e.message});return false;}
  }
  close(){if(!this.open)return;this.open=false;this.pendingAcks.clear();this.pending?.resolve('closed');this.event('closed');}
}
export class MorseAgent {
  constructor({link,generate,goal=DEFAULT_GOAL,style='natural',shareTopic=false,maxTurns=8,maxReplyBytes=180,onEvent=()=>{}}){
    if(!link||typeof generate!=='function'||typeof shareTopic!=='boolean'||typeof goal!=='string'||!goal.trim()||goal.length>600||!Number.isInteger(maxTurns)||maxTurns<2||maxTurns>32||!Number.isInteger(maxReplyBytes)||maxReplyBytes<32||maxReplyBytes>512)throw new Error('AI会話設定が不正です。');
    Object.assign(this,{link,generate,goal,style,shareTopic,maxTurns,maxReplyBytes,onEvent});
    conversationPrompt({...this,sender:link.sender}); // Validate before taking ownership of onData.
    this.history=[];this.active=true;this.busy=false;this.currentSeq=null;this.pendingTopic=null;this.abort=new AbortController();
    link.onData=frame=>this.received(frame);
  }
  event(kind,detail={}){this.onEvent({kind,...detail});}
  systemPrompt(){return conversationPrompt({...this,sender:this.link.sender});}
  async start(topic){
    if(this.link.sender!==0)throw new Error('会話開始は端末Aだけです。Bは受信待機します。');
    if(!this.active)throw new Error('停止済みです。新しいセッションで開始してください。');
    if(this.history.length)throw new Error('会話はすでに開始しています。');
    if(typeof topic!=='string'||!topic.trim()||topic.length>1000)throw new Error('開始する話題を入力してください。');
    if(this.shareTopic)initialTopic(topic,this.maxReplyBytes);
    this.history.push({role:'user',content:topic});await this.reply(1);
  }
  queueTopic(text){
    if(!this.active||!this.link.open||!this.history.length)throw Error('AI会話を開始してから話題を追加してください。');
    if(this.pendingTopic!==null)throw Error('話題変更を予約済みです。送信されるまで待ってください。');
    const seq=this.busy?this.currentSeq+2:this.link.nextSend;
    if(seq>this.maxTurns)throw Error('この端末の残りターンがありません。停止して新しい会話を始めてください。');
    this.pendingTopic=topicMessage(text,this.maxReplyBytes);
    this.event('topic-queued',{seq,text:this.pendingTopic});return seq;
  }
  cancelTopic(){if(this.pendingTopic!==null){this.pendingTopic=null;this.event('topic-cancelled');}}
  async received(frame){
    if(!this.active)return;
    this.history.push({role:'user',content:frame.text});this.event('peer',{seq:frame.seq,text:frame.text});
    if(frame.seq>=this.maxTurns){this.active=false;this.cancelTopic();this.event('complete',{seq:frame.seq});return;}
    await this.reply(frame.seq+1);
  }
  async reply(seq){
    if(!this.active||seq>this.maxTurns)return;
    if(this.busy){this.event('error',{message:'AI生成が重複しました。安全のため停止します。'});this.stop();return;}
    this.busy=true;this.currentSeq=seq;const started=performance.now();
    try{
      let text,origin='ai',repairs=0;
      if(seq===1&&this.shareTopic){
        text=initialTopic(this.history[0].content,this.maxReplyBytes);origin='human-seed';
      }else if(this.pendingTopic!==null){
        text=this.pendingTopic;this.pendingTopic=null;origin='human-topic';
      }else{
        this.event('thinking',{seq});let issue=null,candidate=null;
        for(let attempt=0;attempt<2;attempt++){
          if(!this.active||this.abort.signal.aborted)return;
          text=await this.generate(conversationMessages(this.systemPrompt(),this.history,issue?{issue,text:candidate,maxReplyBytes:this.maxReplyBytes}:null),{signal:this.abort.signal,maxBytes:this.maxReplyBytes});
          if(!this.active)return;
          issue=replyIssue(text,this.history,this.maxReplyBytes);
          if(!issue)break;
          candidate=text;
          if(attempt===0){repairs++;this.event('repairing',{seq,reason:issue,attempt:1});}
          else throw Error('AI応答を一度生成し直しましたが、空文・反復・文字数などの検査を通りませんでした。内容を勝手に切らず停止しました。');
        }
      }
      if(!this.active)return;
      // Only accepted actual utterances enter history; invalid candidates are never sent.
      this.history.push({role:'assistant',content:text});
      this.event('generated',{seq,text,origin,repairs,inferenceMs:origin==='ai'?performance.now()-started:0});
      await this.link.send(text,seq);
      if(seq>=this.maxTurns){this.active=false;this.cancelTopic();this.event('complete',{seq});}
    }catch(e){if(this.active)this.event('error',{message:e.message});this.stop();}
    finally{this.busy=false;this.currentSeq=null;}
  }
  stop(){this.active=false;this.cancelTopic();this.abort.abort();this.link.close();this.event('stopped');}
}
