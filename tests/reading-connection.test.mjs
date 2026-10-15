import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingConnection} from '../app/js/reading-connection.mjs';
class Socket {
  constructor(){this.readyState=0;}
  open(){this.readyState=1;this.onopen();}
  send(raw){this.sent=JSON.parse(raw);}
  close(){this.readyState=3;}
  reply(result){this.onmessage({data:JSON.stringify({id:this.sent.id,result})});}
}
async function connected(options={}){
  const connection=new ReadingConnection({Socket,...options});const opened=connection.open('ws://local/reading');connection.socket.open();await opened;return connection;
}
test('Reading connect timeout and explicit cancel both settle pending open',async()=>{
  const timeout=new ReadingConnection({Socket,timeout:10});await assert.rejects(timeout.open('ws://local'),/タイムアウト/);assert.equal(timeout.socket.readyState,3);
  const cancel=new ReadingConnection({Socket});const opening=cancel.open('ws://local');cancel.close();await assert.rejects(opening,/停止/);
});
test('Reading stop rejects outstanding requests and ignores a queued old reply',async()=>{
  const c=await connected();const request=c.request('音楽');const late=c.socket.onmessage;c.close();
  await assert.rejects(request,/停止/);late({data:'invalid'});assert.equal(c.pending.size,0);
});
test('Malformed reading result fails only its request; valid retry still works',async()=>{
  const c=await connected();try{
    const bad=c.request('音楽');c.socket.reply({unexpected:true});await assert.rejects(bad,/読み変換/);
    const good=c.request('音楽');c.socket.reply({reading:'おんがく'});assert.equal((await good).reading,'おんがく');
    const format=c.request('おんがく','format');c.socket.reply({reading:'おんがく'});await assert.rejects(format,/読み変換/);
  }finally{c.close();}
});
test('Broken connection rejects all reading work once and reports disconnect',async()=>{
  let closed=0;const c=await connected({onClose:()=>closed++});const first=c.request('一'),second=c.request('二');
  c.socket.onmessage({data:'invalid JSON'});await assert.rejects(first,/応答/);await assert.rejects(second,/応答/);assert.equal(closed,1);assert.equal(c.pending.size,0);
});
test('Synchronous send failure does not leave a timer or request pending',async()=>{
  const c=await connected();try{c.socket.send=()=>{throw Error('send failed');};await assert.rejects(c.request('音'),/send failed/);assert.equal(c.pending.size,0);}finally{c.close();}
});
