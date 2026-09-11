import test from 'node:test';import assert from 'node:assert/strict';
import {ReliableMorseLink,MorseAgent} from '../app/core/fast-link.mjs';
import {unpackFastFrame,fastPcm,FastMorseDecoder,packFastFrame} from '../app/core/fast-codec.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function pair({dropAck=false,pcm=false}={}){
 const events=[],received=[[],[]];let links;
 const send=sender=>async bytes=>{
  const frame=unpackFastFrame(bytes);
  if(dropAck&&frame.type==='ack'){dropAck=false;return;}
  let decoded=frame;
  if(pcm){decoded=null;const decoder=new FastMorseDecoder({wpm:600,onFrame:f=>{decoded=f;}}),audio=fastPcm(bytes,{wpm:600});for(let i=0;i<audio.pcm.length;i+=128)decoder.push(audio.pcm.subarray(i,i+128));assert.ok(decoded);}
  // Audio TX does not synchronously await the peer's application/reply.
  setTimeout(()=>{links[1-sender].receive(decoded);},0);
 };
 links=[0,1].map(sender=>new ReliableMorseLink({room:'1234',session:99,sender,sendAudio:send(sender),ackDelayMs:0,ackTimeoutMs:30,maxRetries:1,onData:f=>{received[sender].push(f);},onEvent:e=>events.push({sender,...e})}));
 return {links,events,received};
}
test('lost ACK retries once, but application sees the data exactly once',async()=>{const {links,received,events}=pair({dropAck:true});const r=await links[0].send('こんにちは',1);assert.equal(r.attempts,2);assert.equal(received[1].length,1);assert.ok(events.some(e=>e.kind==='duplicate'));links.forEach(l=>l.close());});
test('wrong room/session/self cannot trigger AI or acknowledge',async()=>{const {links,received}=pair();for(const change of [{room:'9999'},{session:88},{sender:1}])assert.equal(await links[1].receive(unpackFastFrame(packFastFrame({room:'1234',session:99,sender:0,seq:1,text:'x',...change}))),false);assert.equal(received[1].length,0);links.forEach(l=>l.close());});
test('out of order, altered retransmit, duplicate ACK cannot trigger a second AI reply',async()=>{const {links,received}=pair();assert.equal(await links[1].receive({room:'1234',session:99,sender:0,seq:3,text:'future'}),false);await links[0].send('first',1);await links[1].receive({room:'1234',session:99,sender:0,seq:1,text:'changed'});assert.equal(received[1].length,1);links.forEach(l=>l.close());});
test('close releases ACK wait immediately',async()=>{const l=new ReliableMorseLink({session:1,sender:0,sendAudio:async()=>{},ackTimeoutMs:10000});const pending=l.send('test',1);await sleep(2);l.close();await assert.rejects(pending,/停止/);});
test('AI A → real PCM Morse → decoder B → AI B → real PCM Morse → decoder A; six bounded turns',async()=>{
 const {links,events}=pair({pcm:true});const aiEvents=[],calls=[0,0];
 const agents=links.map((link,i)=>new MorseAgent({link,maxTurns:6,generate:async()=>`端末${i?'B':'A'}応答${++calls[i]}。`,onEvent:e=>aiEvents.push({sender:i,...e})}));
 await agents[0].start('会話を開始');
 for(let i=0;i<100&&agents.some(a=>a.active);i++)await sleep(10);
 assert.deepEqual(calls,[3,3]);assert.equal(events.filter(e=>e.kind==='receive').length,6);assert.equal(aiEvents.filter(e=>e.kind==='generated').length,6);assert.equal(agents[0].active,false);assert.equal(agents[1].active,false);agents.forEach(a=>a.stop());
});
test('AI error does not fabricate or silently truncate a reply',async()=>{const {links,events}=pair();const a=new MorseAgent({link:links[0],maxReplyBytes:32,generate:async()=> 'あ'.repeat(100)});await a.start('start');assert.equal(events.filter(e=>e.kind==='transmit').length,0);assert.equal(a.active,false);links[1].close();});
test('stop while AI awaits generation never transmits its late output',async()=>{const {links,events}=pair();let resolve;const a=new MorseAgent({link:links[0],generate:()=>new Promise(r=>{resolve=r;})});const p=a.start('start');await sleep(1);a.stop();resolve('late');await p;assert.equal(events.filter(e=>e.kind==='transmit').length,0);links[1].close();});
test('AI inference overlaps ACK delay, but reply sound never overtakes the ACK',async()=>{
 const order=[];
 const b=new ReliableMorseLink({session:77,sender:1,ackDelayMs:40,ackTimeoutMs:50,maxRetries:0,sendAudio:async bytes=>{const f=unpackFastFrame(bytes);order.push(f.type);if(f.type==='data')setTimeout(()=>b.receive({type:'ack',room:'0000',session:77,sender:0,seq:2,text:''}),0);}});
 const a=new MorseAgent({link:b,maxTurns:2,generate:async()=>{order.push('inference');return '返信';}});
 await b.receive({type:'data',room:'0000',session:77,sender:0,seq:1,text:'質問'});
 assert.deepEqual(order,['inference','ack','data']);a.stop();
});

test('Many duplicate frames share one queued ACK and never generate twice',async()=>{
 const output=[],input=[];
 const link=new ReliableMorseLink({session:77,sender:1,ackDelayMs:20,sendAudio:async bytes=>output.push(unpackFastFrame(bytes)),onData:f=>input.push(f)});
 const f={type:'data',room:'0000',session:77,sender:0,seq:1,text:'はい'};
 await Promise.all(Array.from({length:40},()=>link.receive(f)));
 assert.equal(output.length,1);assert.equal(input.length,1);assert.equal(link.pendingAcks.size,0);
 await link.receive(f);assert.equal(output.length,2);assert.equal(input.length,1);link.close();
});
test('ACK backpressure preserves receive sequence so a dropped frame can be retried',async()=>{
 const link=new ReliableMorseLink({session:77,sender:1,ackDelayMs:25,sendAudio:async()=>{}});
 const frame=seq=>({type:'data',room:'0000',session:77,sender:0,seq,text:'はい'});
 const pending=[1,3,5,7].map(seq=>link.receive(frame(seq)));
 assert.equal(await link.receive(frame(9)),false);assert.equal(link.nextReceive,9);
 assert.ok(!link.incoming.has(9));assert.equal(link.pendingAcks.size,4);
 await Promise.all(pending);assert.equal(await link.receive(frame(9)),true);assert.equal(link.nextReceive,11);link.close();
});
test('Closing a link discards queued ACK work and emits closed exactly once',async()=>{
 let sounds=0,closes=0;const link=new ReliableMorseLink({session:77,sender:1,ackDelayMs:100,sendAudio:async()=>sounds++,onEvent:e=>{if(e.kind==='closed')closes++;}});
 const pending=link.receive({type:'data',room:'0000',session:77,sender:0,seq:1,text:'x'});
 link.close();link.close();await pending;assert.equal(sounds,0);assert.equal(closes,1);assert.equal(link.pendingAcks.size,0);
});
test('Invalid or unbounded conversation goals are rejected before inference',()=>{
 const link=new ReliableMorseLink({session:77,sender:1,sendAudio:async()=>{}});
 for(const goal of ['', ' ',null,'あ'.repeat(601)])assert.throws(()=>new MorseAgent({link,goal,generate:async()=>''}));link.close();
});
