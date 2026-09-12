import {InlineMessage} from '/monitor/inline-message.mjs';

/** Each bubble belongs to one locally observed packet, never to a peer UI. */
export class SignalChat {
  constructor(root){this.root=root;this.reset(0);}
  reset(role){this.role=role;this.rows=new Map();this.current=null;this.raw=null;this.root.replaceChildren();}
  row(sender,seq,type='data'){
    const key=`${sender}:${seq}:${type}`;
    if(this.rows.has(key))return this.rows.get(key);
    const nearBottom=window.innerHeight+window.scrollY>=document.body.scrollHeight-160;
    const node=document.createElement('article');node.className='chat-message';node.dataset.self=String(sender===this.role);node.dataset.sender=sender;
    const heading=document.createElement('header');heading.textContent=`端末 ${sender?'B':'A'}${sender===this.role?' · あなた':''} · ${type==='ack'?'受信確認 ACK':'メッセージ'}`;
    const status=document.createElement('small'),body=document.createElement('div'),letters=document.createElement('div');
    body.className='chat-body';letters.className='chat-letters';letters.setAttribute('aria-label','音から読み取った文字');
    node.append(heading,body,letters,status);this.root.append(node);
    const row={node,status,letters,message:new InlineMessage(body),sender,seq,type};this.rows.set(key,row);
    while(this.rows.size>80){const first=this.rows.keys().next().value;this.rows.get(first).node.remove();this.rows.delete(first);}
    if(nearBottom)node.scrollIntoView({block:'end'});return row;
  }
  begin(sender,seq,type){const row=this.row(sender,seq,type);this.current=row;if(!row.complete)row.status.textContent=sender===this.role?'送信中':'受信中';return row;}
  symbols(text){
    const header=/([AB])(\d{1,5})([=+])/.exec(text);
    if(header){
      const row=this.row(header[1]==='B'?1:0,Number(header[2]),header[3]==='+'?'ack':'data');
      if(row.signal)this.raw=row.signal;
      else{
        if(this.raw?.dataset.packet)this.raw=null;
        if(!this.raw){this.raw=document.createElement('div');this.raw.className='chat-signal';}
        row.signal=this.raw;this.raw.dataset.packet=`${row.sender}:${row.seq}:${row.type}`;
        row.node.insertBefore(this.raw,row.status);
      }
    }else if(this.raw?.dataset.packet)this.raw=null;
    if(!this.raw){this.raw=document.createElement('div');this.raw.className='chat-signal';this.raw.textContent='受信中';this.root.append(this.raw);}
    const previous=this.raw.dataset.latest||'';
    if(previous&&!text.startsWith(previous.trimEnd()))this.raw.dataset.completed=(this.raw.dataset.completed||'')+previous+' ｜ ';
    this.raw.dataset.latest=text;
    this.raw.textContent='受信した符号 · '+((this.raw.dataset.completed||'')+text).replaceAll('�','［不明］');
    // This is the primary microphone decoder's complete observation, including
    // pilot, header and checksum. Keep it separate from CRC-verified content.
  }
  bind(sender,seq,type){const row=this.begin(sender,seq,type);if(this.raw&&!this.raw.dataset.packet){row.signal=this.raw;this.raw.dataset.packet=`${sender}:${seq}:${type}`;row.node.insertBefore(this.raw,row.status);}return row;}
  progress(e){const row=this.row(e.sender,e.seq,e.type);if(row.complete)return;row.message.update(e.wire,{boundary:e.boundary});row.letters.textContent=e.wire;row.status.textContent='受信中';}
  received(f){const row=this.row(f.sender,f.seq,f.type);if(row.complete)return row;row.complete=true;row.message.update(f.wire,{final:true,animate:false});row.letters.textContent=f.wire;row.status.textContent='受信済み';return row;}
  format(f,text){this.rows.get(`${f.sender}:${f.seq}:${f.type}`)?.message.format(text,{wire:f.wire});}
  stop(){for(const row of this.rows.values())if(/中$/.test(row.status.textContent))row.status.textContent='停止';this.current=null;this.raw=null;}
}
