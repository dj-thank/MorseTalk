import { validateInvite, channelKeys, seal, openBox, bytesToMorse, morseToFrame, toBase64 } from '../core/online-protocol.mjs';
/** Two-party relay transport. No audio/microphone, model calls or automatic reconnect. */
export class OnlineTransport {
  constructor({invite,sender,onState=()=>{},WebSocketClass=globalThis.WebSocket,telemetry=false}) {
    this.telemetry=Boolean(telemetry);
    this.invite=validateInvite(invite);if(sender!==0&&sender!==1)throw Error('端末A/Bを選んでください。');
    Object.assign(this,{sender,onState,WebSocketClass});this.closed=true;this.ready=false;this.generation=0;
  }
  async start(onEvent) {
    if(!this.closed)throw Error('オンライン接続は開始済みです。');
    this.closed=false;const epoch=++this.generation;this.onEvent=onEvent;this.rx=Promise.resolve();this.tx=Promise.resolve();this.queued=0;this.counter=0;this.received=0;
    this.nonce=toBase64(crypto.getRandomValues(new Uint8Array(16)));this.peerNonce=null;this.hello=false;
    try {
      this.material=await channelKeys(this.invite);if(this.closed||epoch!==this.generation)throw Error('接続を停止しました。');
      const socket=new this.WebSocketClass(this.invite.r);this.socket=socket;
      const ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
      this.timer=setTimeout(()=>this.fail('相手との接続が時間切れです。両端の招待とネット接続を確認してください。'),60000);
      this.expiry=setTimeout(()=>this.fail('招待の有効期限に到達しました。新しい招待で接続してください。'),Math.max(1,this.invite.e-Date.now()));
      socket.onopen=()=>{if(!this.closed)socket.send(JSON.stringify({t:'join',v:1,room:this.invite.w,auth:this.material.auth,side:this.sender,expires:this.invite.e}));};
      socket.onmessage=e=>{
        if(this.closed||epoch!==this.generation)return;
        if(typeof e.data!=='string'||e.data.length>11000||++this.queued>32){this.fail('受信が過大です。接続を停止しました。');return;}
        this.rx=this.rx.then(()=>this.receive(JSON.parse(e.data),epoch)).catch(()=>this.fail('相手の認証または受信検証に失敗しました。')).finally(()=>this.queued--);
      };
      socket.onerror=()=>this.fail('中継サーバーに接続できません。URL・TLS・ネット接続を確認してください。');
      socket.onclose=()=>this.fail('オンライン接続が切断されました。自動再接続せず停止します。');
      this.onState('中継へ接続中…相手も同じ招待で接続してください。');
      return await ready;
    }catch(e){if(epoch===this.generation)this.stop();throw e;}
  }
  async sendPayload(payload) {
    const epoch=this.generation;
    const result=this.tx.then(async()=>{
      if(this.closed)throw Error('オンライン接続は停止しています。');
      const box=await seal(this.material.keys,this.invite,this.sender,payload);
      if(this.closed||epoch!==this.generation||this.socket.readyState!==1)throw Error('送信前に切断されました。');
      if(this.socket.bufferedAmount>65536)throw Error('送信キューが混雑しています。');
      this.socket.send(JSON.stringify(box));
    });this.tx=result.catch(()=>{});return result;
  }
  async receive(message,epoch) {
    if(this.closed||epoch!==this.generation)return;
    if(message.t==='waiting'){this.onState('相手の接続待ち。同じ招待を共有してください。');return;}
    if(message.t==='paired'){
      if(this.hello)throw Error('Duplicate peer');this.hello=true;
      await this.sendPayload({t:'hello',nonce:this.nonce,pair:this.invite.p});return;
    }
    if(message.t==='error'||message.t==='left')throw Error('Relay rejected or peer left');
    if(!this.hello||message.t!=='box')throw Error('Unexpected envelope');
    const payload=await openBox(this.material.keys,this.invite,1-this.sender,message);
    if(this.closed||epoch!==this.generation)return;
    if(payload.t==='hello') {
      if(this.peerNonce||typeof payload.nonce!=='string'||!/^[A-Za-z0-9_-]{22}$/.test(payload.nonce)||payload.pair!==this.invite.p)throw Error('Peer settings differ');
      this.peerNonce=payload.nonce;await this.sendPayload({t:'proof',nonce:this.nonce,echo:this.peerNonce,pair:this.invite.p});return;
    }
    if(payload.t==='proof') {
      if(this.ready||!this.peerNonce||payload.nonce!==this.peerNonce||payload.echo!==this.nonce||payload.pair!==this.invite.p)throw Error('Peer proof mismatch');
      this.ready=true;clearTimeout(this.timer);this.timer=null;this.onState('相手との暗号化接続を確認しました。');
      this.resolve({transport:'online-encrypted-morse',peerVerified:true});this.resolve=null;this.reject=null;return;
    }
    if(!this.ready||payload.t!=='morse'||payload.to!==this.nonce||payload.from!==this.peerNonce||payload.n!==this.received+1||this.received>=256)throw Error('Replay or sequence mismatch');
    const frame=morseToFrame(payload.m);if(frame.sender!==1-this.sender)throw Error('Wrong sender');
    this.received=payload.n;if(this.telemetry)this.onEvent({kind:'rx-wire',morse:payload.m});this.onEvent({kind:'frame',frame});
  }
  async transmit(bytes) {
    if(this.closed||!this.ready)throw Error('相手との接続確認が完了していません。');
    if(this.counter>=256)throw Error('接続の送信上限に到達しました。');
    if(this.telemetry){try{this.onEvent({kind:'tx',bytes:Array.from(bytes),seconds:0});}catch{}}
    await this.sendPayload({t:'morse',from:this.nonce,to:this.peerNonce,n:++this.counter,m:bytesToMorse(bytes)});
  }
  fail(message) {
    if(this.closed)return;const notify=this.onEvent;this.stop();notify?.({kind:'fatal',message});
  }
  stop() {
    if(this.closed)return;this.closed=true;this.ready=false;++this.generation;
    clearTimeout(this.timer);clearTimeout(this.expiry);this.timer=null;this.expiry=null;
    const reject=this.reject;this.resolve=null;this.reject=null;reject?.(Error('オンライン接続を終了しました。'));
    const socket=this.socket;this.socket=null;if(socket){socket.onmessage=null;socket.onopen=null;socket.onerror=null;socket.onclose=null;try{socket.close(1000);}catch{}}
    this.material=null;this.peerNonce=null;this.nonce=null;
  }
}
