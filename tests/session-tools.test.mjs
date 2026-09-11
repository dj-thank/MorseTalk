import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionCode,parseConnectionCode,newSessionId,importProgress,SessionJournal} from '../app/core/session-tools.mjs';
const base={room:'1234',session:0x20260911,wpm:600,maxTurns:8,maxReplyBytes:180};
test('Connection code carries both peers turn/byte limits but no role, AI endpoint or consent',()=>{
 const code=connectionCode({...base,endpoint:'private',consent:true,sender:1});
 assert.equal(code,'MT2|1234|20260911|600|8|180');assert.deepEqual(parseConnectionCode(code),base);
});
for(const wpm of [120,300,600,1200])test(`Connection code roundtrip at ${wpm} WPM`,()=>{
 for(const session of [1,0x80000000,0xffffffff])for(const maxTurns of [2,8,32])for(const maxReplyBytes of [32,180,512]){
  const config={...base,session,wpm,maxTurns,maxReplyBytes};assert.deepEqual(parseConnectionCode(connectionCode(config)),config);
 }
});
test('Code parser tolerates only surrounding whitespace and hexadecimal letter case',()=>{
 assert.equal(parseConnectionCode('  MT2|1234|aabbccdd|600|8|180\n').session,0xaabbccdd);
});
for(const text of ['MT2|1234|00000000|600|8|180','MT2|1234|AABBCCDD|600|99|180','MT2|1234|AABBCCDD|600|8|999','MT2|1234|AABBCCDD|1201|8|180','MT1|1234|AABBCCDD|600|8|180','MT2|1234|AABBCCDD|600|8|180|https://bad','<img src=x>','MT2|1234|AABB CCDD|600|8|180'])test(`Reject invalid connection code ${text}`,()=>assert.throws(()=>parseConnectionCode(text)));
test('Reject invalid settings and oversized input before changing anything',()=>{
 for(const patch of [{room:'１２３４'},{session:NaN},{session:0},{session:2**32},{maxTurns:2.1},{maxReplyBytes:31},{wpm:0}])assert.throws(()=>connectionCode({...base,...patch}));
 assert.throws(()=>parseConnectionCode('x'.repeat(101)));assert.throws(()=>parseConnectionCode(null));
});
test('Session creation uses injectable secure randomness, never timestamp/Math.random fallback',()=>{
 let calls=0;assert.equal(newSessionId({getRandomValues(a){a[0]=++calls===1?0:0xffffffff;return a;}}),0xffffffff);
 assert.equal(calls,2);assert.throws(()=>newSessionId({}));
 assert.throws(()=>newSessionId({getRandomValues:a=>a.fill(0)}));
});
test('Import progress is bounded and unknown total is indeterminate, not fictional percent',()=>{
 assert.deepEqual(importProgress({copiedBytes:500,totalBytes:1000}),{bytes:500,total:1000,fraction:.5});
 assert.equal(importProgress({copiedBytes:1200,totalBytes:1000}).fraction,1);
 for(const totalBytes of [null,-1,0,NaN])assert.equal(importProgress({totalBytes}).fraction,null);
 assert.equal(importProgress({copiedBytes:-1}).bytes,0);
});
test('Journal records exact counters, freezes time on stop, and redacts by default',()=>{
 let now=100;const j=new SessionJournal(()=>now);j.reset('microphone');
 now=200;j.record({kind:'generated',text:'private text',seq:1,endpoint:'private URL',token:'SECRET',inferenceMs:20});
 j.record({kind:'peer',text:'peer text',seq:2});j.record({kind:'peer',text:'peer text',seq:2});
 j.record({kind:'delivered',seq:1});j.record({kind:'transmit',seq:1,attempt:1});
 assert.equal(j.turns,2);assert.equal(j.retries,1);j.finish();now=1000;assert.equal(j.elapsedMs,100);
 const safe=JSON.stringify(j.export());for(const value of ['private text','peer text','private URL','SECRET'])assert.ok(!safe.includes(value));
 assert.ok(JSON.stringify(j.export(true)).includes('private text'));assert.equal(j.export().physicalLinkVerified,false);
 j.reset('idle');assert.equal(j.events.length,0);assert.equal(j.turns,0);assert.equal(j.retries,0);
});
test('Journal is capacity bounded and exports detached records',()=>{
 const j=new SessionJournal(()=>0,4);for(let i=0;i<1000;i++)j.record({kind:'ignored',message:'sensitive failure'});
 assert.equal(j.events.length,4);assert.equal(j.dropped,996);assert.ok(!JSON.stringify(j.export()).includes('sensitive failure'));
 const copy=j.export(true);copy.events[0].kind='modified';assert.equal(j.events[0].kind,'ignored');
});
