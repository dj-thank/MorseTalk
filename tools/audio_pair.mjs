/** TEST HARNESS, not part of the shipped application.
 * Only the physical cable/microphones are substituted with live MediaStreams.
 * Production FastAudio, AudioWorklet, link ARQ and agents run on a real audio clock.
 * No decoded text/frame is passed between peers except through the receiver worklet.
 */
async (config) => {
  const {FastAudio} = await import('/js/fast-audio.mjs');
  const {ReliableMorseLink, MorseAgent} = await import('/core/fast-link.mjs');
  const {fastDuration, unpackFastFrame} = await import('/core/fast-codec.mjs');
  const {generateReply} = await import('/js/ai-client.mjs');
  const NativeContext = globalThis.AudioContext;
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia;
  const originalConnect = AudioNode.prototype.connect;
  const contexts = [new NativeContext({sampleRate:48000}), new NativeContext({sampleRate:48000})];
  const sinks = contexts.map(c => c.createMediaStreamDestination());
  const destinations = new Map(contexts.map((c,i) => [c, sinks[i]]));
  const options = {room:'0000',session:0x20260911,wpm:config.wpm || 1200,frequency:4000,volume:0.3};
  const events=[], audio=[], links=[], agents=[], captures=[], transmissions=[];
  const started=performance.now();
  const result={ok:false, real_llm:config.realAI===true, physical_devices:false,
    transport:'real-time WebAudio MediaStream -> production AudioWorklet',
    microphone_source:'virtual cable (not physical microphone)',events,transmissions};
  let nextContext=0,nextMicrophone=0, fatal=null;
  const event = (side,e) => {events.push({side,ms:performance.now()-started,...e}); if(e.kind==='error'||e.kind==='fatal')fatal=e.message;};
  try {
    // Retain real AudioBuffer scheduling and receiver processing; reroute only endpoints.
    AudioNode.prototype.connect = function(destination,...args) {
      return originalConnect.call(this, destination===this.context.destination && destinations.has(this.context)
        ? destinations.get(this.context) : destination, ...args);
    };
    globalThis.AudioContext = function(){if(nextContext>1)throw Error('Unexpected audio context');return contexts[nextContext++];};
    navigator.mediaDevices.getUserMedia = async () => {
      if(nextMicrophone>1)throw Error('Unexpected capture');
      const stream=sinks[1-nextMicrophone++].stream.clone();captures.push(stream);return stream;
    };
    for(let side=0;side<2;side++) {
      event(side,{kind:'audio-starting',options:structuredClone(options)});
      const engine=new FastAudio(options);audio.push(engine);
      const actual=await engine.start(e=>{
        if(e.kind==='frame') {
          event(side,{kind:'decoded',seq:e.frame.seq,type:e.frame.type,text:e.frame.text});
          links[side]?.receive(e.frame).catch(err=>{fatal=String(err);});
        } else if(e.kind==='fatal'||e.kind==='error')event(side,e);
      });
      event(side,{kind:'audio-started',...actual});
    }
    globalThis.AudioContext=NativeContext;
    navigator.mediaDevices.getUserMedia=originalGetUserMedia;
    for(let side=0;side<2;side++) {
      const link=new ReliableMorseLink({...options,sender:side,ackDelayMs:400,ackTimeoutMs:5000,maxRetries:1,
        onEvent:e=>event(side,e),sendAudio:async bytes=>{
          const frame=unpackFastFrame(bytes),begin=performance.now();
          await audio[side].transmit(bytes);
          const elapsed=performance.now()-begin,seconds=fastDuration(bytes,options);
          transmissions.push({side,seq:frame.seq,type:frame.type,signalSeconds:seconds,playbackMs:elapsed});
          if(elapsed<seconds*1000-75)throw Error('Transmission completed before real-time playback');
        }});
      links.push(link);
      const generate=config.realAI
        ? (messages,args)=>generateReply(messages,{...args,model:config.model,consent:true})
        : async messages=>'検証'+messages.filter(m=>m.role==='assistant').length+'。';
      agents.push(new MorseAgent({link,generate,maxTurns:4,maxReplyBytes:512,
        goal:'防災用品を一つずつ提案する。日本語の非常に短い一文で答える。',onEvent:e=>event(side,e)}));
    }
    const first=agents[0].start('地震への備えとして、何を用意しますか。');
    const deadline=performance.now()+(config.realAI?240000:60000);
    while(agents.some(a=>a.active)) {
      if(fatal)throw Error(fatal);
      if(performance.now()>deadline)throw Error('Conversation deadline exceeded');
      await new Promise(r=>setTimeout(r,25));
    }
    await first;
    await Promise.all(links.map(l=>l.queue));
    if(fatal)throw Error(fatal);
    const generated=events.filter(e=>e.kind==='generated');
    const received=events.filter(e=>e.kind==='peer');
    const delivered=events.filter(e=>e.kind==='delivered');
    if(generated.length!==4||received.length!==4||delivered.length!==4)
      throw Error(`Incomplete exchange: generated=${generated.length}, received=${received.length}, ack=${delivered.length}`);
    for(const message of generated) {
      const peer=received.find(e=>e.side!==message.side && e.seq===message.seq);
      if(!peer||peer.text!==message.text)throw Error('End-to-end text mismatch');
    }
    result.turns=generated.map(e=>({side:e.side,seq:e.seq,text:e.text,inferenceMs:e.inferenceMs}));
    result.ok=true;
  } catch(e) {
    result.error=String(e);
    result.errorStack=e?.stack || null;
  } finally {
    agents.forEach(a=>a.stop());links.forEach(l=>l.close());audio.forEach(a=>a.stop());
    globalThis.AudioContext=NativeContext;
    navigator.mediaDevices.getUserMedia=originalGetUserMedia;
    AudioNode.prototype.connect=originalConnect;
    sinks.forEach(s=>s.stream.getTracks().forEach(t=>t.stop()));
    await Promise.all(contexts.map(c=>c.state==='closed'?null:c.close().catch(()=>{})));
    result.elapsedMs=performance.now()-started;
    result.captureTracksEnded=captures.every(s=>s.getTracks().every(t=>t.readyState==='ended'));
  }
  return result;
}
