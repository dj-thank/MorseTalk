/** One cancellable reading connection per Signal session. */
export class ReadingConnection {
  constructor({Socket=globalThis.WebSocket,timeout=6000,onClose=()=>{}}={}){
    Object.assign(this,{Socket,timeout,onClose});this.pending=new Map();this.closed=false;this.id=0;
  }
  open(url){
    if(this.socket||this.closed)return Promise.reject(Error('接続は開始済みです。'));
    return new Promise((resolve,reject)=>{
      const finish=error=>{
        if(!this.opening)return;
        clearTimeout(this.timer);this.opening=null;error?reject(error):resolve();
      };
      this.opening=finish;
      this.timer=setTimeout(()=>this.fail(Error('PC接続がタイムアウトしました。接続手順を確認して再試行してください。')),this.timeout);
      try{
        const socket=this.socket=new this.Socket(url);
        socket.onopen=()=>{if(!this.closed)finish();};
        socket.onerror=()=>this.fail(Error('PCに接続できません。読み変換サーバーとADB転送を確認してください。'));
        socket.onclose=()=>this.fail(Error('PC接続が切れました。接続を確認して再試行してください。'));
        socket.onmessage=({data})=>{
          if(this.closed)return;
          let message;
          try{message=JSON.parse(data);}catch{this.fail(Error('PCからの応答を読み取れません。'));return;}
          const call=this.pending.get(message?.id);if(!call)return;
          this.pending.delete(message.id);clearTimeout(call.timer);
          const result=message.result;
          if(!result||typeof result!=='object'||result.error||typeof result.reading!=='string'||
              (call.mode==='format'&&typeof result.display!=='string'))call.reject(Error('読み変換に失敗しました。PCの読み辞書を確認してください。'));
          else call.resolve(result);
        };
      }catch(error){this.fail(error);}
    });
  }
  request(text,mode='reading'){
    if(typeof text!=='string'||!text.trim()||text.length>600)return Promise.reject(Error('AIの返答に変換できる本文がありません。'));
    if(this.closed||this.socket?.readyState!==1)return Promise.reject(Error('PCに接続されていません。'));
    const id=String(++this.id);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('PCの読み変換がタイムアウトしました。'));},this.timeout);
      this.pending.set(id,{resolve,reject,timer,mode});
      try{this.socket.send(JSON.stringify({id,text,mode}));}
      catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
    });
  }
  fail(error){if(this.closed)return;const opening=!!this.opening;this.close(error);if(!opening)this.onClose(error);}
  close(error=Error('接続を停止しました。')){
    if(this.closed)return;this.closed=true;this.opening?.(error);clearTimeout(this.timer);
    for(const call of this.pending.values()){clearTimeout(call.timer);call.reject(error);}this.pending.clear();
    if(this.socket){this.socket.onopen=this.socket.onclose=this.socket.onerror=this.socket.onmessage=null;try{this.socket.close();}catch{}}
  }
}
