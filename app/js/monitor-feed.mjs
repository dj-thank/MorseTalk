/** Optional demo telemetry: mirror this endpoint's Morse activity to a loopback monitor.
 * Off by default. Accepts only ws://127.0.0.1|localhost/feed so nothing leaves the device
 * except through an owner-approved ADB reverse mapping. Drops events when not connected.
 */
export function validMonitorUrl(text){
  let u;try{u=new URL(String(text||'').trim());}catch{return null;}
  if(u.protocol!=='ws:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.pathname!=='/feed'||u.search||u.hash||u.username||u.password)return null;
  return u.href;
}
export class MonitorFeed {
  constructor(url,{role=0,label='',WebSocketImpl=globalThis.WebSocket}={}){
    this.url=validMonitorUrl(url);if(!this.url)throw new Error('監視先は ws://127.0.0.1:ポート/feed だけです。');
    this.role=role;this.label=label;this.WebSocketImpl=WebSocketImpl;this.socket=null;this.closed=false;this.queue=[];this.retryAt=0;this.sent=0;this.dropped=0;
    this.connect();
  }
  connect(){
    if(this.closed||this.socket||Date.now()<this.retryAt)return;
    try{
      const s=new this.WebSocketImpl(this.url);this.socket=s;
      s.onopen=()=>{if(this.socket!==s)return;this.send({kind:'hello'});for(const e of this.queue.splice(0))this.raw(e);};
      s.onclose=s.onerror=()=>{if(this.socket===s){this.socket=null;this.retryAt=Date.now()+1500;}};
      s.onmessage=()=>{};// The monitor never controls the endpoint.
    }catch{this.socket=null;this.retryAt=Date.now()+1500;}
  }
  raw(payload){
    const s=this.socket;
    if(!s||s.readyState!==1||s.bufferedAmount>262144){this.dropped++;return false;}
    try{s.send(payload);this.sent++;return true;}catch{this.dropped++;return false;}
  }
  send(event){
    if(this.closed)return;
    const payload=JSON.stringify({t:Date.now(),role:this.role,label:this.label,...event});
    if(payload.length>20000){this.dropped++;return;}
    if(!this.socket||this.socket.readyState!==1){
      this.connect();
      if(this.queue.length<64&&!/^(level)$/.test(event.kind))this.queue.push(payload);else this.dropped++;
      return;
    }
    this.raw(payload);
  }
  stop(){this.closed=true;const s=this.socket;this.socket=null;this.queue=[];if(s){try{s.close(1000);}catch{}}}
}
