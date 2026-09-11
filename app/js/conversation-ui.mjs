import { TOPICS, STYLES, DEFAULT_GOAL } from '../core/conversation.mjs';
/** Topic controls never bypass the agent/link or grant model/network consent. */
export function createConversationUI({getAgent,isRunning,changed,error,runSingle}) {
  const $=id=>document.getElementById(id);
  const label=document.createElement('label');label.textContent='会話のスタイル';
  const select=document.createElement('select');select.id='conversation-style';
  for(const [value,style] of Object.entries(STYLES))select.add(new Option(style.label,value));
  label.append(select);$('goal').closest('label').before(label);
  const group=document.createElement('optgroup');group.label='いろいろな話題';
  for(const topic of TOPICS)group.append(new Option(topic.label,topic.id));
  $('preset').append(group);
  const single=document.createElement('button');single.id='conversation-single';single.className='secondary';single.textContent='1台でAI同士の会話を試す';
  const note=document.createElement('p');note.className='help';note.textContent='実際のGemmaを2役で呼び、発言をモールスPCM化・復号して受け渡します。最大8ターン。音は鳴らさず、2台の実通信とは別の試用モードです。';
  $('topic').closest('label').after(single,note);
  const panel=document.createElement('div');panel.className='topic-steering';
  const topicLabel=document.createElement('label');topicLabel.textContent='会話中に次の話題を挟む';
  const input=document.createElement('textarea');input.id='next-topic';input.rows=2;input.maxLength=200;input.placeholder='今度は、音楽の話をしてみよう';topicLabel.append(input);
  const send=document.createElement('button');send.id='queue-topic';send.textContent='次の自分側ターンで話題を送る';
  const cancel=document.createElement('button');cancel.id='cancel-topic';cancel.className='secondary';cancel.textContent='話題の予約を取り消す';
  const buttons=document.createElement('div');buttons.className='buttons';buttons.append(send,cancel);
  const hint=document.createElement('p');hint.className='help';hint.id='topic-status';hint.setAttribute('role','status');hint.textContent='話題変更の文そのものを同じモールス経路で送ります。1ターンを使い、生成中の発言は中断しません。';
  panel.append(topicLabel,buttons,hint);$('transcript').after(panel);
  $('preset').addEventListener('change',()=>{
    if(isRunning())return;
    const topic=TOPICS.find(t=>t.id===$('preset').value);
    if(topic){$('goal').value=DEFAULT_GOAL;$('topic').value=topic.topic;changed();}
  });
  select.addEventListener('change',()=>{if(!isRunning())changed();});
  single.addEventListener('click',()=>{if(isRunning())return;Promise.resolve().then(runSingle).catch(error);});
  send.addEventListener('click',()=>{
    try{
      const agent=getAgent();if(!agent)throw Error('AI会話を開始してください。');
      const seq=agent.queueTopic(input.value);hint.textContent=`ターン${seq}に話題変更を予約しました。相手へ届くまでは話題は切り替わりません。`;input.value='';refresh();
    }catch(e){error(e);}
  });
  cancel.addEventListener('click',()=>{getAgent()?.cancelTopic();hint.textContent='話題変更の予約を取り消しました。';refresh();});
  function refresh(){
    const running=isRunning(),agent=getAgent();select.disabled=running;single.disabled=running;
    const active=Boolean(agent?.active&&agent.history.length);
    input.disabled=!active;send.disabled=!active||agent.pendingTopic!==null;cancel.disabled=!active||agent.pendingTopic===null;
  }
  refresh();
  return {refresh,style:()=>select.value,event(e){
    if(e.kind==='generated'&&e.origin==='human-topic')hint.textContent='話題変更を送信中です。相手からの受信確認を待っています。';
    if(e.kind==='topic-cancelled')hint.textContent='未送信の話題変更を取り消しました。';
    refresh();
  }};
}
