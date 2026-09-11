(async()=>{
  const {newInvite}=await import('https://appassets.androidplatform.net/core/online-protocol.mjs');
  const {OnlineTransport}=await import('https://appassets.androidplatform.net/js/online-transport.mjs');
  const {ReliableMorseLink}=await import('https://appassets.androidplatform.net/core/fast-link.mjs');
  const options={room:'0000',session:0x20260911,wpm:120,maxTurns:4,maxReplyBytes:180};
  const invite=newInvite(window.proofRelay,options),transports=[],links=[],received=[],events=[];
  try {
    for(let side=0;side<2;side++)transports.push(new OnlineTransport({invite,sender:side}));
    await Promise.all(transports.map((t,i)=>t.start(e=>{if(e.kind==='frame')links[i]?.receive(e.frame);if(e.kind==='fatal')events.push(e.kind);} )));
    for(let side=0;side<2;side++)links.push(new ReliableMorseLink({...options,sender:side,sendAudio:b=>transports[side].transmit(b),ackDelayMs:0,ackTimeoutMs:2000,onData:f=>received.push(f.text)}));
    const texts=['こんにちは。','接続できました。','漢字と絵文字🙂','正確に受信。'];
    for(let i=0;i<4;i++)await links[i%2].send(texts[i],i+1);
    await new Promise(r=>setTimeout(r,100));
    if(JSON.stringify(texts)!==JSON.stringify(received))throw Error('Network text mismatch');
    if(events.length)throw Error('Unexpected connection failure');
    window.onlineProof={ok:true,received,transport:'actual Android WebView WebSocket -> loopback relay via ADB reverse',physicalDevices:false,realLLM:false};
  }catch(e){window.onlineProof={ok:false,error:String(e)};}
  finally {links.forEach(l=>l.close());transports.forEach(t=>t.stop());}
})();
