/** Backend A/B: isolated worker memories, a timed PCM channel, actual local LLM.
 * stdout is telemetry only. Peer text enters an agent ONLY through its PCM decoder.
 */
import { Worker, isMainThread, parentPort, workerData, threadId } from 'node:worker_threads';
import readline from 'node:readline';
import { ReliableMorseLink, MorseAgent } from '../app/core/fast-link.mjs';
import { unpackFastFrame } from '../app/core/fast-codec.mjs';
import { kanaToWire, packPhonetic, phoneticPcm, PhoneticDecoder } from '../app/core/phonetic-morse.mjs';
import { discussionPrompt, parseDiscussion, DISCUSSION_SCHEMA, parseDisplay, DISPLAY_SCHEMA } from '../app/core/discussion.mjs';
import { dictionaryReading, dictionaryFormat } from './japanese-reading.mjs';

if(isMainThread){
  let workers=[],active=false,channel=Promise.resolve(),timer=null;
  const complete=new Set(),presentations=new Set();let presentationDeadline=null;
  const output=e=>process.stdout.write(JSON.stringify({t:Date.now(),...e})+'\n');
  const finish=async(error)=>{
    if(!active)return;active=false;clearTimeout(timer);clearTimeout(presentationDeadline);
    if(error)output({kind:'error',role:0,message:String(error.message||error)});
    for(const role of [0,1])output({kind:'stopped',role});
    await Promise.all(workers.map(w=>w.terminate()));output({kind:'session-ended',complete:complete.size===2,error:error?String(error.message||error):null});process.exitCode=error?1:0;process.stdin.destroy();
  };
  const maybeFinish=()=>{
    if(complete.size!==2)return;
    if(!presentations.size)channel.then(()=>finish());
    else if(!presentationDeadline)presentationDeadline=setTimeout(()=>finish(),6000);
  };
  const play=async(role,msg)=>{
    if(!active)return;
    const bytes=Uint8Array.from(msg.bytes),f=unpackFastFrame(bytes),pcm=new Float32Array(msg.pcm),start=Date.now()+180;
    output({kind:'phonetic-tx',role,seq:f.seq,type:f.type,text:msg.text,wire:msg.wire,payload:msg.payload,language:msg.language,audioStart:start,seconds:pcm.length/48000});
    output({kind:'channel',role:1-role,sender:role,seq:f.seq,type:f.type,phase:'receiving'});
    await new Promise(resolve=>{
      let offset=0;
      const tick=()=>{
        if(!active){resolve();return;}
        const end=Math.min(pcm.length,Math.max(0,Math.floor((Date.now()-start)*48)));
        if(end>offset){const chunk=pcm.slice(offset,end);workers[1-role].postMessage({kind:'pcm',sender:role,seq:f.seq,type:f.type,buffer:chunk.buffer},[chunk.buffer]);offset=end;}
        if(end<pcm.length)timer=setTimeout(tick,12);
        else{output({kind:'channel',role:1-role,sender:role,seq:f.seq,type:f.type,phase:'complete'});workers[role].postMessage({kind:'sent',id:msg.id});resolve();}
      };tick();
    });
  };
  const input=readline.createInterface({input:process.stdin});
  input.on('line',line=>{
    let c;try{c=JSON.parse(line);}catch{return;}
    if(c.kind==='stop'){finish();return;}
    if(c.kind!=='start'||active)return;
    if(!Number.isFinite(c.wpm)||c.wpm<=0||![0,4,6].includes(c.maxTurns)||typeof c.topic!=='string'||!c.topic.trim())throw Error('Invalid session configuration');
    active=true;
    workers=[0,1].map(role=>new Worker(new URL(import.meta.url),{workerData:{...c,role}}));
    workers.forEach((w,role)=>{
      w.on('message',e=>{
        if(!active)return;
        if(e.kind==='play'){channel=channel.then(()=>play(role,e)).catch(finish);return;}
        output({role,...e});
        if(e.kind==='presentation-start')presentations.add(`${role}:${e.seq}`);
        if(e.kind==='presentation-end'){presentations.delete(`${role}:${e.seq}`);maybeFinish();}
        if(e.kind==='complete'){complete.add(role);maybeFinish();}
        if(e.kind==='error')finish(Error(e.message));
      });
      w.on('error',finish);
    });
  });
  input.on('close',()=>finish());
}else{
  const c=workerData,role=c.role,language=c.language||'ja',opts={wpm:c.wpm,frequency:700,sampleRate:48000,volume:.24};
  const room='0000',session=c.session;let id=0;const pending=new Map(),prepared=new Map(),replyReadings=new Map();
  const emit=e=>{if(e.kind==='delivered')prepared.delete('data:'+e.seq);parentPort.postMessage({...e,worker:threadId});};let incomingSignal=null;
  async function model(messages,signal,purpose='conversation',schema){
    const body={model:c.model,messages,stream:false,max_tokens:purpose==='conversation'?384:256,temperature:purpose==='conversation'?.4:0};
    if(schema)body.response_format={type:'json_schema',json_schema:{name:purpose,strict:true,schema}};
    const deadline=AbortSignal.timeout(purpose==='display'?4000:90000);
    const response=await fetch(c.endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},signal:signal?AbortSignal.any([signal,deadline]):deadline,body:JSON.stringify(body)});
    if(!response.ok)throw Error(`Gemmaへの接続に失敗しました (${response.status})。`);
    const result=await response.json(),text=result.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim())throw Error('Gemmaから有効な返答が届きませんでした。');
    emit({kind:'model-reply',purpose,model:result.model||c.model,usage:result.usage});return text.trim();
  }
  async function payloadFor(frame){
    if(frame.type==='ack')return {wire:'',text:''};
    const text=frame.text.replace(/^話題[：:]\s*/, '');
    if(replyReadings.has(text))return replyReadings.get(text);
    if(language==='en')return {wire:text.toUpperCase().replace(/!/g,'.'),text:text.toUpperCase().replace(/!/g,'.')};
    try{return kanaToWire(text);}catch{}
    emit({kind:'preparing-reading',seq:frame.seq});
    const raw=await model([{role:'system',content:'入力の読みをひらがなだけに変換する。意味を変えたり、内容を足さない。数字と英字も日本語の読みへ。JSONのreadingに読みを書く。'},{role:'user',content:text}],null,'reading',{type:'object',properties:{reading:{type:'string'}},required:['reading'],additionalProperties:false});
    const match=raw.match(/\{[\s\S]*\}/);if(!match)throw Error('読みを取得できませんでした。');
    return kanaToWire(JSON.parse(match[0]).reading);
  }
  const ack=phoneticPcm(packPhonetic({sender:role,seq:1,type:'ack'}),opts);
  const link=new ReliableMorseLink({room,session,sender:role,ackDelayMs:160,ackTimeoutMs:Math.ceil(ack.seconds*1000+2500),onEvent:emit,
    sendAudio:async bytes=>{
      const frame=unpackFastFrame(bytes),key=frame.type+':'+frame.seq;
      if(frame.type!=='ack'&&!prepared.has(key))prepared.set(key,await payloadFor(frame));
      const payload=frame.type==='ack'?{wire:'',text:''}:prepared.get(key),wire=packPhonetic({...frame,wire:payload.wire}),{pcm}=phoneticPcm(wire,opts);
      return new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});parentPort.postMessage({kind:'play',id:request,bytes:Array.from(bytes),wire,payload:payload.wire,text:payload.text,language,pcm:pcm.buffer},[pcm.buffer]);});
    }});
  async function present(frame){
    if(language!=='ja'||frame.type!=='data')return;
    emit({kind:'presentation-start',sender:frame.sender,seq:frame.seq,session});let displayed=false;
    try{
      const quick=await dictionaryFormat(frame.text,null,c.readingPython);
      if(quick?.engine==='windows-ime'){const text=parseDisplay(JSON.stringify(quick),frame.text,quick.reading);emit({kind:'message-display',sender:frame.sender,seq:frame.seq,session,received:frame.text,wire:frame.wire,text,readingCheck:'windows-ime'});displayed=true;return;}
      const raw=await model([{role:'system',content:'あなたは受信したひらがなを読みやすい漢字かな交じりの表記に整える係です。返答や説明、新情報を加えず、同じ言葉だけを表記変更します。同音異義語が不明ならひらがなを維持します。JSONのdisplayに整えた文、readingにその文の正確なひらがな読みを返してください。句読点を除き受信文の読みを変えないこと。'},{role:'user',content:JSON.stringify({topic:c.topic,received:frame.text})}],null,'display',DISPLAY_SCHEMA);
      const proposed=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||'{}');
      const checked=await dictionaryFormat(frame.text,proposed.display,c.readingPython);
      const text=checked?parseDisplay(JSON.stringify(checked),frame.text,checked.reading):parseDisplay(raw,frame.text);
      emit({kind:'message-display',sender:frame.sender,seq:frame.seq,session,received:frame.text,wire:frame.wire,text,readingCheck:checked?'dictionary':'model'});displayed=true;
    }catch{
      const checked=await dictionaryFormat(frame.text,null,c.readingPython);
      if(checked){try{const text=parseDisplay(JSON.stringify(checked),frame.text,checked.reading);emit({kind:'message-display',sender:frame.sender,seq:frame.seq,session,received:frame.text,wire:frame.wire,text,readingCheck:'dictionary-fallback'});displayed=true;}catch{}}
    } // The CRC-verified kana remains usable if optional formatting fails.
    finally{emit({kind:'presentation-end',sender:frame.sender,seq:frame.seq,session,displayed});}
  }
  const decoder=new PhoneticDecoder({language,wpm:c.wpm,onMark:e=>emit({kind:'mark',signalSender:incomingSignal?.sender,signalSeq:incomingSignal?.seq,signalType:incomingSignal?.type,...e}),onCharacter:e=>emit({kind:'phonetic-character',...e}),
    onError:(message,observed={})=>emit({kind:'invalid',message,...observed,signalSender:incomingSignal?.sender,signalSeq:incomingSignal?.seq}),
    onFrame:f=>{const frame={...f,room,session};emit({kind:'frame',frame,phonetic:true});present(frame);link.receive(frame).catch(error=>emit({kind:'error',message:error.message}));}});
  class ConversationAgent extends MorseAgent {
    systemPrompt(){return discussionPrompt({role,topic:c.topic,language,turn:this.currentSeq,last:this.currentSeq===c.maxTurns});}
  }
  const agent=new ConversationAgent({link,maxTurns:c.maxTurns,maxReplyBytes:132,shareTopic:false,onEvent:emit,
    generate:async(messages,{signal})=>{
      const received=[...messages].reverse().find(m=>m.role==='user')?.content||'';
      let issue='';
      for(let attempt=0;attempt<2;attempt++){
        const request=attempt?messages.map((m,i)=>i===0?{...m,content:m.content+`\n送信前の確認: ${issue} 内容を具体的な一文に直してJSONを返してください。`}:m):messages;
        const raw=await model(request,signal,'conversation',DISCUSSION_SCHEMA);
        try{
          const proposal=JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0]||'{}');let reading=language==='en'?proposal.reply:await dictionaryReading(proposal.reply,c.readingPython);
          if(language==='ja'){
            try{if(!reading)throw Error();kanaToWire(reading);}catch{reading=(await payloadFor({type:'data',seq:agent.currentSeq,text:proposal.reply})).text;}
          }
          const data=parseDiscussion(raw,language,reading,{turn:agent.currentSeq,last:agent.currentSeq===c.maxTurns});replyReadings.set(data.reply,data.phonetic);while(replyReadings.size>16)replyReadings.delete(replyReadings.keys().next().value);
          emit({kind:'agent-awareness',self:role,peer:1-role,source:agent.currentSeq===1&&agent.history.length===1?'topic':'peer',received,understanding:data.understanding,focus:data.focus});return data.reply;
        }catch(error){issue=error.message;if(attempt)throw error;emit({kind:'repairing',seq:agent.currentSeq,reason:issue,attempt:1});}
      }
    }});
  parentPort.on('message',m=>{
    if(m.kind==='pcm'){incomingSignal={sender:m.sender,seq:m.seq,type:m.type};decoder.push(new Float32Array(m.buffer));}
    if(m.kind==='sent'){pending.get(m.id)?.resolve();pending.delete(m.id);}
  });
  emit({kind:'session',transport:'backend-phonetic',language,wpm:c.wpm,unitMs:1200/c.wpm,room,session,mode:'ai',maxTurns:c.maxTurns,model:c.model});
  emit({kind:'topic-context',topic:c.topic,starter:role===0,peer:1-role});
  if(role===0)agent.start(c.topic).catch(error=>emit({kind:'error',message:error.message}));
}
