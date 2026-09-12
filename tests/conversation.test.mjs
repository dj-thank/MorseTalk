import test from 'node:test';
import assert from 'node:assert/strict';
import {TOPICS, STYLES, DEFAULT_GOAL, conversationPrompt, conversationMessages, replyIssue, topicMessage, initialTopic} from '../app/core/conversation.mjs';
import {ReliableMorseLink,MorseAgent} from '../app/core/fast-link.mjs';
import {unpackFastFrame,fastPcm,FastMorseDecoder} from '../app/core/fast-codec.mjs';
import {SessionJournal} from '../app/core/session-tools.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function single(generate,{maxTurns=8,maxReplyBytes=180,shareTopic=false,onEvent=()=>{}}={}) {
  const frames=[],events=[];let link;
  link=new ReliableMorseLink({session:91,sender:0,ackTimeoutMs:200,maxRetries:0,sendAudio:async bytes=>{
    const frame=unpackFastFrame(bytes);frames.push(frame);
    if(frame.type==='data')setTimeout(()=>link.receive({...frame,type:'ack',sender:1,text:''}),0);
  }});
  const a=new MorseAgent({link,generate,maxTurns,maxReplyBytes,shareTopic,onEvent:e=>{events.push(e);onEvent(e,a);}});
  return {a,frames,events};
}
for(const topic of TOPICS)test(`Editable ${topic.id} seed is a topic, not a canned AI reply`,()=>{
  assert.ok(topic.id&&topic.label&&topic.topic);assert.ok(topic.topic.length<=1000);assert.equal(Object.hasOwn(topic,'response'),false);
});
for(const style of Object.keys(STYLES))test(`Role-aware ${style} prompt remains stable and prioritizes peer topic`,()=>{
  const a=conversationPrompt({sender:0,goal:DEFAULT_GOAL,style,maxReplyBytes:180});
  const b=conversationPrompt({sender:1,goal:DEFAULT_GOAL,style,maxReplyBytes:180});
  assert.notEqual(a,b);assert.match(a,/直前の相手の話題/);assert.match(a,/UTF-8で180/);
  assert.equal(a,conversationPrompt({sender:0,goal:DEFAULT_GOAL,style,maxReplyBytes:180}));
});
test('Invalid style fails before replacing receive handler',()=>{
  const link=new ReliableMorseLink({session:1,sender:0,sendAudio:async()=>{}}),before=link.onData;
  assert.throws(()=>new MorseAgent({link,style:'__proto__',generate:async()=>''}));assert.equal(link.onData,before);link.close();
});
test('Heuristic distinguishes a bare acknowledgement from substantive agreement',()=>{
  for(const t of ['はい。','はいどうぞ','こんにちは','なるほど！','ありがとうございます。','  ','!?'])assert.ok(replyIssue(t,[],180),t);
  for(const t of ['はい、低い音を足すと落ち着くと思います。','なるほど、月の地下には何があるかな？','音楽の話をしよう。'])assert.equal(replyIssue(t,[],180),null,t);
});
test('Exact repeated own message is rejected; relevant short quotations are allowed',()=>{
  const h=[{role:'assistant',content:'月にはどんな資源があるかな？'}];
  assert.equal(replyIssue('月にはどんな資源があるかな!',h,180),'repeat');
  assert.equal(replyIssue('月の氷を調べたいな。',h,180),null);
});
test('UTF-8 validation does not split emoji or silently truncate output',()=>{
  assert.equal(replyIssue('🙂'.repeat(9),[],32),'length');assert.equal(replyIssue('\uD800',[],180),'unicode');
  assert.throws(()=>topicMessage('🙂'.repeat(50),180));assert.match(topicMessage('音楽を話そう'),/^話題を変えよう。/);
});
test('Recent history remains exact and begins with user after bounded trimming',()=>{
  const h=Array.from({length:30},(_,i)=>({role:i%2===0?'assistant':'user',content:`${i}：`+'あ'.repeat(170)}));
  const original=JSON.stringify(h),m=conversationMessages('SYSTEM',h);
  assert.equal(m[0].content,'SYSTEM');assert.equal(m[1].role,'user');assert.equal(m.at(-1).content,h.at(-1).content);
  assert.ok(m.length<=13);assert.ok(m.slice(1).reduce((n,x)=>n+new TextEncoder().encode(x.content).length,0)<=4000);
  assert.equal(JSON.stringify(h),original);
});
test('Normal follow-up preserves exact history prefix for native cache reuse',()=>{
  const h=[{role:'user',content:'音楽の話をしよう'}],m=conversationMessages('SYSTEM',h);
  h.push({role:'assistant',content:'どんな楽器の音が好き？'},{role:'user',content:'ピアノの音が好きだよ。'});
  assert.deepEqual(conversationMessages('SYSTEM',h).slice(0,2),m);
});
test('Repair prompt is local to one attempt and never modifies stored conversation',()=>{
  const h=[{role:'user',content:'音楽について話そう'}],before=JSON.stringify(h);
  assert.match(conversationMessages('S',h,'repeat').at(-1).content,/修正指示/);
  assert.equal(JSON.stringify(h),before);assert.equal(conversationMessages('S',h).at(-1).content,h[0].content);
});
test('Bad candidate is regenerated once before any bytes are sent',async()=>{
  let calls=0;const {a,frames,events}=single(async()=>++calls===1?'はい。':'旋律に変化があると面白いね。');
  await a.start('音楽');assert.equal(calls,2);assert.equal(frames.length,1);assert.equal(frames[0].text,'旋律に変化があると面白いね。');
  assert.equal(events.filter(e=>e.kind==='repairing').length,1);assert.equal(a.history.some(m=>m.content==='はい。'),false);a.stop();
});
test('Two failed candidates stop instead of looping, fabricating or sending a partial reply',async()=>{
  let calls=0;const {a,frames}=single(async()=>{calls++;return 'あ'.repeat(100);},{maxReplyBytes:32});
  await a.start('音楽');assert.equal(calls,2);assert.equal(frames.length,0);assert.equal(a.active,false);
});
test('Stopping in repair event prevents a second inference',async()=>{
  let calls=0;const {a,frames}=single(async()=>{calls++;return 'はい。';},{onEvent:(e,a)=>{if(e.kind==='repairing')a.stop();}});
  await a.start('音楽');assert.equal(calls,1);assert.equal(frames.length,0);
});
test('Model error never silently switches model or initiates a retry',async()=>{
  let calls=0;const {a,frames}=single(async()=>{calls++;throw Error('model unavailable');});
  await a.start('音楽');assert.equal(calls,1);assert.equal(frames.length,0);
});
test('Queue during generation applies only at next local turn, through ordinary Morse PCM',async()=>{
  let release;const {a,frames,events}=single(()=>new Promise(r=>{release=r;}));
  const first=a.start('休日');assert.equal(a.queueTopic('音楽の話をしよう。'),3);
  assert.throws(()=>a.queueTopic('科学の話'));release('休日は外を歩いてみたい。');await first;
  await a.received({seq:2,text:'景色を眺めると気分が変わるね。'});
  assert.equal(frames.length,2);assert.equal(frames[1].seq,3);assert.match(frames[1].text,/話題を変えよう。音楽/);
  let decoded;const decoder=new FastMorseDecoder({wpm:1200,onFrame:f=>decoded=f});
  const {packFastFrame}=await import('../app/core/fast-codec.mjs');decoder.push(fastPcm(packFastFrame(frames[1]),{wpm:1200}).pcm);
  assert.equal(decoded.text,frames[1].text);assert.equal(events.find(e=>e.kind==='generated'&&e.seq===3).origin,'human-topic');a.stop();
});
test('Topic change cannot start a stopped agent or overrun remaining turn budget',async()=>{
  const {a}=single(async()=> '今は音楽について話すよ。',{maxTurns:2});assert.throws(()=>a.queueTopic('科学'));
  await a.start('音楽');assert.throws(()=>a.queueTopic('科学'));a.stop();await assert.rejects(a.start('音楽'),/停止/);
});
test('Cancelled topic and stopped-session topic are never delivered',async()=>{
  let calls=0;const {a,frames}=single(async()=>`考えを追加する${++calls}。`);
  await a.start('音楽');a.queueTopic('料理');a.cancelTopic();await a.received({seq:2,text:'次はどう思う？'});
  assert.equal(frames.some(f=>f.text.includes('料理')),false);a.queueTopic('宇宙');a.stop();assert.equal(a.pendingTopic,null);
});
test('Queued human topics stay private in default log but their origin is visible',()=>{
  const log=new SessionJournal();log.record({kind:'generated',origin:'human-topic',text:'private topic',seq:3});
  assert.equal(log.export().events[0].origin,'human-topic');assert.equal('text' in log.export().events[0],false);
});

test('Repair carries a bounded unsent candidate and exact shorter target, without modifying history',()=>{
  const h=[{role:'user',content:'音楽の話をしよう'}],before=JSON.stringify(h);
  const prompt=conversationMessages('S',h,{issue:'length',text:'旋律'.repeat(5000),maxReplyBytes:180}).at(-1).content;
  assert.match(prompt,/未送信の案/);assert.match(prompt,/日本語20文字程度/);assert.ok(new TextEncoder().encode(prompt).length<2500);
  assert.equal(JSON.stringify(h),before);
});

test('Initial topic crosses the ordinary frame before peer inference; never invented by the first AI',async()=>{
  let calls=0;const {a,frames,events}=single(async()=>{calls++;return '月の氷を調べたいです。';},{shareTopic:true});
  await a.start('月の研究基地で調べたいことは？');
  assert.equal(calls,0);assert.equal(frames[0].text,'話題：月の研究基地で調べたいことは？');
  assert.equal(events.find(e=>e.kind==='generated').origin,'human-seed');a.stop();
});
test('Oversized shared topic is rejected before history or sequence advances; no silent shortening',async()=>{
  const {a,frames}=single(async()=> '応答',{shareTopic:true,maxReplyBytes:32});
  await assert.rejects(a.start('長い初期話題'.repeat(50)),/短く/);assert.equal(a.history.length,0);assert.equal(a.link.nextSend,1);assert.equal(frames.length,0);a.stop();
});
test('Unexpected Korean drift is repaired, while explicit Korean learning remains possible',()=>{
  assert.equal(replyIssue('古い看板은 재미있어요。',[{role:'user',content:'街歩きの話をしよう'}],180),'language');
  assert.equal(replyIssue('안녕하세요。',[{role:'user',content:'韓国語の挨拶を教えて'}],180),null);
  assert.equal(replyIssue('音楽について考えよう。',[],180),null);
});
test('Human initial topic has explicit origin but is absent from text-free diagnostics',()=>{
  const journal=new SessionJournal();journal.record({kind:'generated',origin:'human-seed',text:'private seed',seq:1});
  assert.equal(journal.export().events[0].origin,'human-seed');assert.equal('text' in journal.export().events[0],false);
});
