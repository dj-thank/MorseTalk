async config => {
  const {TOPICS,DEFAULT_GOAL}=await import('/core/conversation.mjs');
  const {ReliableMorseLink,MorseAgent}=await import('/core/fast-link.mjs');
  const {fastPcm,FastMorseDecoder}=await import('/core/fast-codec.mjs');
  const {generateReply}=await import('/js/ai-client.mjs');
  const topic=TOPICS.find(t=>t.id===config.topic),maxTurns=config.turns||4;
  const report={ok:false,topic:config.topic,style:config.style,turns:[],received:[],delivered:[],repairs:[],errors:[]};
  const agents=[],links=[];const start=performance.now();let queued=false;
  try {
    for(let side=0;side<2;side++)links.push(new ReliableMorseLink({room:'0000',session:901,sender:side,ackDelayMs:0,ackTimeoutMs:1000,maxRetries:0,
      onEvent:e=>{if(e.kind==='delivered')report.delivered.push({side,seq:e.seq});},
      sendAudio:async bytes=>{
        let decoded;const decoder=new FastMorseDecoder({wpm:1200,sampleRate:48000,onFrame:f=>decoded=f});
        const pcm=fastPcm(bytes,{wpm:1200,sampleRate:48000}).pcm;
        for(let i=0;i<pcm.length;i+=128)decoder.push(pcm.subarray(i,i+128));
        if(!decoded)throw Error('Production PCM decoder failed');
        setTimeout(()=>links[1-side].receive(decoded).catch(e=>report.errors.push(String(e))),0);
      }}));
    for(let side=0;side<2;side++)agents.push(new MorseAgent({link:links[side],goal:DEFAULT_GOAL,style:config.style,maxTurns,maxReplyBytes:180,
      generate:(messages,args)=>generateReply(messages,{...args,consent:true,model:config.model}),
      onEvent:e=>{
        if(e.kind==='generated'){
          report.turns.push({side,seq:e.seq,text:e.text,origin:e.origin,inferenceMs:e.inferenceMs});
          if(side===0&&config.switchTopic&&!queued){queued=true;agents[0].queueTopic(config.switchTopic);}
        }
        if(e.kind==='peer')report.received.push({side,seq:e.seq,text:e.text});
        if(e.kind==='repairing')report.repairs.push({side,seq:e.seq,reason:e.reason});
        if(e.kind==='error')report.errors.push(e.message);
      }}));
    const first=agents[0].start(topic.topic);const deadline=performance.now()+270000;
    while(agents.some(a=>a.active)){
      if(report.errors.length)throw Error(report.errors.join(' / '));
      if(performance.now()>deadline)throw Error('Conversation deadline exceeded');
      await new Promise(r=>setTimeout(r,20));
    }
    await first;await Promise.all(links.map(l=>l.queue));
    if(report.errors.length)throw Error(report.errors.join(' / '));
    if(report.turns.length!==maxTurns||report.received.length!==maxTurns||report.delivered.length!==maxTurns)throw Error('Incomplete acknowledged exchange');
    for(const sent of report.turns){const received=report.received.find(r=>r.seq===sent.seq&&r.side!==sent.side);if(!received||received.text!==sent.text)throw Error('End-to-end mismatch');}
    if(config.switchTopic){const change=report.turns.find(t=>t.origin==='human-topic');if(!change||change.seq!==3||!change.text.includes(config.switchTopic))throw Error('Topic change was not delivered as its own ordinary Morse turn');}
    report.ok=true;
  }catch(e){report.error=String(e);}
  finally{agents.forEach(a=>a.stop());links.forEach(l=>l.close());report.elapsedMs=performance.now()-start;}
  return report;
}
