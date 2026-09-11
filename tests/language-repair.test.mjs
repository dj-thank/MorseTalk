import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationMessages,replyIssue} from '../app/core/conversation.mjs';
import {ReliableMorseLink,MorseAgent} from '../app/core/fast-link.mjs';
import {unpackFastFrame} from '../app/core/fast-codec.mjs';
function single(generate){
  const frames=[],events=[];let link;
  link=new ReliableMorseLink({session:91,sender:0,ackTimeoutMs:200,maxRetries:0,sendAudio:async bytes=>{
    const frame=unpackFastFrame(bytes);frames.push(frame);
    if(frame.type==='data')setTimeout(()=>link.receive({...frame,type:'ack',sender:1,text:''}),0);
  }});
  const a=new MorseAgent({link,generate,onEvent:e=>events.push(e)});return {a,frames,events};
}

for(const candidate of [
  '조용하고 은은한 조명이 독서에 집중하게 해. 어떤 종류의 책들이 주로 있나요?',
  '静かで落ち着いた雰囲気야. 어떤 종류의 책들이 주로 있나요?',
])test('Language repair isolates the actual rejected candidate from the conversation prefix: '+candidate,()=>{
  const h=[{role:'user',content:'話題：夜だけ開く本屋の創作を続けよう。'},
           {role:'assistant',content:'木製の扉が静かに開いた。'},
           {role:'user',content:'夜の本屋って、どんな雰囲気なの？'}];
  const before=JSON.stringify(h);
  assert.equal(replyIssue(candidate,h,180),'language');
  const request=conversationMessages('ORIGINAL CONVERSATION SYSTEM',h,{issue:'language',text:candidate,maxReplyBytes:180});
  assert.equal(request.length,2);assert.equal(request[0].role,'system');assert.match(request[0].content,/日本語の文章を整える編集者/);
  assert.equal(request[1].role,'user');assert.ok(request[1].content.includes(candidate));
  assert.ok(!request.some(m=>m.role==='assistant'));assert.match(request[0].content,/180バイト以内/);
  assert.equal(JSON.stringify(h),before);assert.equal(conversationMessages('NORMAL',h)[0].content,'NORMAL');
});
test('Language correction still stops after one unsuccessful real-model revision',async()=>{
  let calls=0;const {a,frames}=single(async messages=>{calls++;if(calls===2)assert.match(messages[0].content,/編集者/);return '静かな本屋야。';});
  await a.start('夜の本屋');assert.equal(calls,2);assert.equal(frames.length,0);assert.equal(a.active,false);
});
test('Language correction validates the replacement against the original history before sending',async()=>{
  let calls=0;const {a,frames,events}=single(async()=>++calls===1?'조용한 책방이야.':'静かな本屋です。');
  await a.start('夜の本屋');assert.equal(calls,2);assert.equal(frames.length,1);assert.equal(frames[0].text,'静かな本屋です。');
  assert.equal(events.find(e=>e.kind==='repairing').reason,'language');assert.equal(a.history.some(m=>m.content.includes('책방')),false);a.stop();
});
