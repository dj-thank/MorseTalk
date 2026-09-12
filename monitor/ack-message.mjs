import {InlineMessage} from './inline-message.mjs';
export function ackText(sender,seq){
  if(![0,1].includes(sender)||!Number.isInteger(seq)||seq<1)return '';
  return `端末${sender?'B':'A'}がメッセージ${seq}の受信を確認しました（本文なしACK）。`;
}
export class AckMessage {
  constructor(message){this.root=document.createElement('div');this.root.className='ack-message';this.root.hidden=true;message.after(this.root);}
  show(sender,seq,state){const text=ackText(sender,seq);if(!text)return;if(state==='sent'&&this.root.dataset.state==='received'&&this.root.dataset.seq===String(seq)&&this.root.dataset.sender===String(sender))return;this.contentKey=null;this.inline=null;this.root.hidden=false;this.root.dataset.state=state;this.root.dataset.seq=String(seq);this.root.dataset.sender=String(sender);
    const title=document.createElement('strong'),body=document.createElement('p');title.textContent=`受信確認（ACK） · ${{sending:'送信中',sent:'送信済み',receiving:'受信中',received:'受信済み'}[state]||state}`;
    body.textContent=state==='receiving'?`端末${sender?'B':'A'}からの確認信号を読み取っています。`:text;this.root.replaceChildren(title,body);
  }
  hide(){this.root.hidden=true;this.contentKey=null;this.inline=null;this.root.dataset.state='';this.root.replaceChildren();}
  begin(sender,seq,state){const key=`${sender}:${seq}`;if(this.contentKey===key&&this.root.dataset.state==='received'&&state==='sent')return;if(this.contentKey!==key){this.contentKey=key;this.root.replaceChildren();this.title=document.createElement('strong');this.body=document.createElement('p');this.body.className='message-body';this.root.append(this.title,this.body);this.inline=new InlineMessage(this.body);}this.root.hidden=false;this.root.dataset.state=state;this.title.textContent=`端末${sender?'B':'A'} · 受信確認（ACK） · ${{sending:'送信中',sent:'送信済み',receiving:'受信中',received:'受信済み'}[state]||state}`;}
  progress(sender,seq,wire,{final=false,boundary=false,state='receiving',language='ja'}={}){this.begin(sender,seq,state);this.inline.update(wire,{final,boundary,language,animate:!final});}
  outgoing(sender,seq,text){this.begin(sender,seq,'sending');this.inline.plain(text);}
  format(sender,seq,wire,text){if(this.contentKey===`${sender}:${seq}`)return this.inline?.format(text,{wire});return false;}
  interrupt(){if(['sending','receiving'].includes(this.root.dataset.state)){this.root.dataset.state='stopped';this.root.querySelector('strong').textContent='受信確認（ACK） · 中断';this.root.querySelector('p').textContent='確認信号の処理を停止しました。';}}
}
