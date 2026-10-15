import test from 'node:test';
import assert from 'node:assert/strict';
import {SignalConversation} from '../monitor/conversation.js';
function setup(){
  const saved={WebSocket:globalThis.WebSocket,location:globalThis.location};const sockets=[],unlocks=[],finishes=[];
  globalThis.location={host:'local'};
  globalThis.WebSocket=class{constructor(){this.readyState=0;sockets.push(this);}close(){this.readyState=3;}send(){}};
  const audio={unlock:()=>new Promise((resolve,reject)=>unlocks.push({resolve,reject})),stop(){},configure(){}};
  const conversation=new SignalConversation({audio,onFinished:e=>finishes.push(e)});
  return {conversation,sockets,unlocks,finishes,restore(){conversation.stop();for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}};
}
test('Monitor stop during audio unlock never opens a late conversation socket',async()=>{
  const h=setup();try{const p=h.conversation.start('music');h.conversation.stop();h.unlocks[0].resolve();await p;assert.equal(h.sockets.length,0);}finally{h.restore();}
});
test('Monitor ignores duplicate starts and old audio failures after restart',async()=>{
  const h=setup();try{
    const first=h.conversation.start('old');await h.conversation.start('duplicate');assert.equal(h.unlocks.length,1);
    h.conversation.stop();const second=h.conversation.start('new');h.unlocks[1].resolve();await second;
    h.unlocks[0].reject(Error('old failure'));await first;assert.equal(h.conversation.active,true);assert.equal(h.sockets.length,1);
  }finally{h.restore();}
});
test('Monitor ignores stale socket callbacks after a new conversation starts',async()=>{
  const h=setup();try{
    const first=h.conversation.start('old');h.unlocks[0].resolve();await first;const old=h.sockets[0];h.conversation.stop();
    const second=h.conversation.start('new');h.unlocks[1].resolve();await second;old.onerror();old.onclose();old.onmessage({data:'{"kind":"session-ended"}'});
    assert.equal(h.conversation.active,true);h.sockets[1].onmessage({data:'not JSON'});assert.equal(h.conversation.active,false);assert.match(h.finishes.at(-1).message,/応答/);
  }finally{h.restore();}
});
