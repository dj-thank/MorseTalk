/** Real WebSockets through the actual Python relay; no audio hardware, no actual LLM. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newInvite } from '../app/core/online-protocol.mjs';
import { OnlineTransport } from '../app/js/online-transport.mjs';
import { ReliableMorseLink, MorseAgent } from '../app/core/fast-link.mjs';
const url=process.argv[2];if(!url)throw Error('Pass loopback relay URL');
const opts={room:'0000',session:0x10203040,wpm:1200,maxTurns:4,maxReplyBytes:180};
const invite=newInvite(url,opts),transport=[],links=[],agents=[],events=[],wire=[];
const NativeWS=globalThis.WebSocket;
class RecordedSocket extends NativeWS { send(text){wire.push(text);return super.send(text);} }
const started=performance.now();let failure=null;
try {
  for(let sender=0;sender<2;sender++)transport.push(new OnlineTransport({invite,sender,WebSocketClass:RecordedSocket}));
  await Promise.all(transport.map((t,i)=>t.start(e=>{if(e.kind==='frame')links[i]?.receive(e.frame).catch(e=>failure=e);if(e.kind==='fatal')failure=e.message;})));
  for(let sender=0;sender<2;sender++){
    const link=new ReliableMorseLink({...opts,sender,ackDelayMs:0,ackTimeoutMs:1000,sendAudio:bytes=>transport[sender].transmit(bytes),onEvent:e=>events.push({side:sender,...e})});links.push(link);
    agents.push(new MorseAgent({...opts,link,generate:async messages=>`端末${sender}の応答${messages.length}。`,onEvent:e=>events.push({side:sender,...e})}));
  }
  await agents[0].start('開始します。');
  const deadline=Date.now()+10000;
  while(agents.some(a=>a.active)){if(failure)throw Error(failure);if(Date.now()>deadline)throw Error('4-turn timeout');await new Promise(r=>setTimeout(r,5));}
  await Promise.all(links.map(l=>l.queue));
  const sent=events.filter(e=>e.kind==='generated'),received=events.filter(e=>e.kind==='peer');
  assert.equal(sent.length,4);assert.equal(received.length,4);assert.equal(events.filter(e=>e.kind==='delivered').length,4);
  for(const e of sent)assert.equal(received.find(x=>x.side!==e.side&&x.seq===e.seq)?.text,e.text);
  assert.ok(wire.every(x=>!x.includes(invite.k)&&!x.includes('端末')));
  const result={ok:true,actualWebSockets:true,endToEndEncrypted:true,representation:'Morse dots and dashes',actualAI:false,ai:'explicit test double',elapsedMs:performance.now()-started,turns:sent.map(e=>({side:e.side,seq:e.seq,text:e.text})),delivered:4,retries:events.filter(e=>e.kind==='timeout').length};
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/online-wire.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {agents.forEach(a=>a.stop());links.forEach(l=>l.close());transport.forEach(t=>t.stop());}
