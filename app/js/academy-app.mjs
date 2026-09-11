import { tableFor, encodeText, decodeCode } from '../core/morse.mjs';
import { LESSON_ORDER, alphabet, trainingTiming, trainingSegments, grade, readProgress, recordGrade, mastered, question, KeyCapture, TutorSession } from '../core/academy.mjs';
import { AcademyAudio } from './academy-audio.mjs';
import { ACADEMY_CSS, ACADEMY_HTML } from './academy-view.mjs';
import { generateReply } from './ai-client.mjs';
import { hasNative, nativeCall, cancelNativeRecognition } from './voice.mjs';
export function mountAcademy({canOpen=()=>true,onClose=()=>{},onSettings=null,startOpen=false}={}){
  if(document.getElementById('academy-root'))return {setLocked(){},open(){}};
  const style=document.createElement('style');style.textContent=ACADEMY_CSS;document.head.append(style);
  const root=document.createElement('div');root.id='academy-root';root.hidden=true;root.innerHTML=ACADEMY_HTML;document.body.append(root);
  const $=id=>document.getElementById(`ac-${id}`),launch=document.createElement('button');
  launch.id='academy-launch';launch.type='button';launch.textContent='モールスを覚える · SIGNAL SCHOOL　→';
  launch.style.cssText='display:block;width:100%;padding:20px;margin:18px 0;border:1px solid #bac8ad;border-radius:16px;background:#eaf0e0;color:#2b4f38;font-weight:700;text-align:left';
  const header=document.querySelector('body>main>header');if(header)header.after(launch);else document.body.insertBefore(launch,root);
  let storage=null,progress=readProgress(null),page='home',target=null,buffer='',assisted=false,played=0,graded=false,busy=false,epoch=0,exam=null,keyTimer=null,holdTimer=null,activePointer=null,previousFocus=null,lastAiBubble=null;
  try{storage=globalThis.localStorage;progress=readProgress(storage.getItem('morsetalk-academy-v1'));}catch{$('home').querySelector('.ac-note').textContent+=' この環境では記録を保存できません。画面を閉じると消えます。';}
  const player=new AcademyAudio({onSignal:on=>root.dataset.signal=on?'on':'off'}),tutor=new TutorSession(generateReply);
  let capture=new KeyCapture(),lastMode='international';
  const inertBefore=new Map();
  function settings(){
    const mode=$('mode').value,count=$('count').value==='all'?LESSON_ORDER[mode].length:Number($('count').value);
    return {mode,count,characterWpm:Number($('char-wpm').value),effectiveWpm:Number($('effective-wpm').value)};
  }
  function notify(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error);}
  function persist(){try{storage?.setItem('morsetalk-academy-v1',JSON.stringify(progress));}catch{notify('記録の保存に失敗しました。今回の結果は画面内に保持しています。',true);}stats();}
  function stats(){
    const mode=settings().mode,n=mastered(progress,mode),total=LESSON_ORDER[mode].length,clean=progress.attempts-progress.aided;
    $('mastery').replaceChildren(document.createTextNode(String(n)),Object.assign(document.createElement('small'),{textContent:`/ ${total}`}));
    $('attempts').replaceChildren(document.createTextNode(String(progress.attempts)),Object.assign(document.createElement('small'),{textContent:'回'}));
    $('accuracy').textContent=clean?`${Math.round(progress.exact/clean*100)}%`:'—';
    root.querySelector('.ac-next-letters').textContent=alphabet(mode,2).join(' ');
  }
  function aiOptions(){
    const get=id=>document.getElementById(id);
    if(!get('model'))throw new Error('AI交信は既存のAI Link画面で開いてください。単独プレビューは学習用です。');
    if(!get('consent')?.checked)throw new Error('「接続・モデル」でモデルを準備し、指定AIに会話を渡す許可を確認してください。');
    const model=get('model').value.trim();if(!model)throw new Error('「接続・モデル」で導入済みモデルを指定してください。');
    return {model,provider:get('provider').value,endpoint:get('endpoint').value,backend:get('local-backend').value,consent:true};
  }
  function isAIExam(){return page==='chat'&&$('chat-mode').value==='exam';}
  function quizActive(){return page==='exam'&&exam?.active;}
  function refresh(){
    const inputEnabled=(page==='send'||(page==='chat'&&!isAIExam()))&&!busy;
    for(const id of ['key','dot','dash','letter','word','back','clear','send','compose-code','voice'])$(id).disabled=!inputEnabled;
    $('play').disabled=busy||!target;
    $('reveal').disabled=busy||!target;
    $('next').disabled=busy||page==='chat'||(page==='exam'&&(!exam?.active||!graded));
    $('check').disabled=busy||!target||graded||played===0;
    $('answer').disabled=busy||!target||graded;
    $('ai-question').disabled=busy||(isAIExam()&&target&&!graded);
    $('chat-reset').disabled=busy;$('chat-mode').disabled=busy;
    $('exam-start').disabled=busy;
    for(const id of ['mode','count','char-wpm','effective-wpm'])$(id).disabled=busy||Boolean(quizActive());
    root.querySelectorAll('#ac-dictionary button').forEach(button=>button.disabled=busy);
  }
  function cancelKey(){
    clearTimeout(keyTimer);clearTimeout(holdTimer);keyTimer=null;holdTimer=null;
    capture.release(performance.now(),{cancelled:true});activePointer=null;$('key').dataset.down='false';player.stop();
  }
  function stop(message='音とAIを停止しました。'){
    ++epoch;busy=false;tutor.stop();cancelKey();cancelNativeRecognition();notify(message);refresh();
  }
  async function perform(action){
    if(busy)return;
    const token=++epoch;busy=true;refresh();
    try{await action(()=>token===epoch&&!root.hidden);}catch(error){if(token===epoch&&error.name!=='AbortError')notify(error.message,true);}
    finally{if(token===epoch){busy=false;refresh();}}
  }
  function resetInput(){clearTimeout(keyTimer);capture.reset();buffer='';$('code').textContent='ここに信号が並びます';$('decoded').textContent='復号した文字：—';}
  function code(){return buffer.trim().replace(/(?:\s*\/\s*)+$/,'').trim();}
  function updateInput(){
    $('code').textContent=buffer?buffer.replaceAll('.', '·').replaceAll('-', '−'):'ここに信号が並びます';
    try{$('decoded').textContent=`復号した文字：${decodeCode(code(),settings().mode,{strict:false}).text||'—'}`;}catch{$('decoded').textContent='復号した文字：区切りを確認してください';}
  }
  function appendMark(mark,aided=false){
    if(buffer.length>=600){notify('入力は600符号までです。短い文章に分けてください。',true);return;}
    buffer+=mark;assisted ||= aided;updateInput();
  }
  function letter(){clearTimeout(keyTimer);if(buffer.trim()&&!buffer.endsWith(' '))buffer+=' ';updateInput();}
  function word(){clearTimeout(keyTimer);if(code())buffer=code()+' / ';updateInput();}
  function setTarget(value){
    target=value;played=0;graded=false;assisted=false;$('answer').value='';$('result').hidden=true;$('feedback').textContent='';resetInput();
    const show=page==='send';$('prompt').classList.toggle('ac-concealed',!show);$('prompt').textContent=show?value.text:'耳をすませて。';
    $('question-area').hidden=false;$('answer-form').hidden=show||(page==='chat'&&!isAIExam());
    $('round').textContent=quizActive()?`${exam.results.length+1} / 10`:page==='chat'?'AIが生成した信号':'1文字から、少しずつ';
    $('next').textContent=quizActive()&&exam.results.length===9?'結果を見る →':'次の問題 →';refresh();
  }
  function newQuestion(){
    stop('新しい問題を用意しました。');
    const cfg=settings(),skill=page==='send'?'send':'listen';
    setTarget(question({...cfg,skill,length:quizActive()?3:cfg.count>8?3:1,progress}));
    if(page==='send')notify('表示された文字を、電鍵か補助ボタンで打ってください。');
  }
  function addLog(who,text){
    const bubble=document.createElement('div');bubble.className='ac-bubble';bubble.dataset.who=who;
    bubble.append(Object.assign(document.createElement('small'),{textContent:who==='user'?'YOU · 復号した送信文':'AI · 指定したモデル'}),document.createTextNode(text));$('thread').append(bubble);
    while($('thread').childElementCount>24)$('thread').firstElementChild.remove();$('thread').scrollTop=$('thread').scrollHeight;return bubble;
  }
  function reveal(){
    if(!target||busy)return;assisted=true;$('prompt').classList.remove('ac-concealed');$('prompt').textContent=`${target.text}\n${target.code.replaceAll('.', '·').replaceAll('-', '−')}`;
    if(page==='chat'&&lastAiBubble){lastAiBubble.replaceChildren(Object.assign(document.createElement('small'),{textContent:'AI · 復号した受信文'}),document.createTextNode(target.text));}
    notify('答えを表示しました。この問題は補助ありとして扱います。');
  }
  async function playTarget(){
    if(!target)return;const selected=target,segments=trainingSegments(selected.code,settings());
    await perform(async current=>{
      notify('信号を再生しています。音量は端末側で調整できます。');
      if(played>0||page==='send')assisted=true;
      const complete=await player.play(segments);
      if(!current()||!complete)return;played++;notify('再生が終わりました。聞こえた文字を入力してください。');
      if(page!=='send'&&!(page==='chat'&&!isAIExam()))$('answer').focus();
    });
  }
  function evaluate(answer,skill){
    if(!target||graded||busy)return;
    const result=grade(target.text,answer,{mode:settings().mode,assisted});graded=true;
    recordGrade(progress,result,settings().mode,skill);persist();
    $('result').hidden=false;$('result').dataset.error=String(!result.exact);
    $('result').textContent=`${result.exact?'一致しました。':'もう一度、確かめよう。'} ${result.accuracy}%${result.assisted?' · 補助あり':''}\n正解：${result.expected}\n回答：${result.answer||'（空白）'}`;
    const errors=result.alignment.filter(p=>p.expected!==p.actual).map(p=>`${p.expected||'余分な文字'} → ${p.actual||'抜け'}`);
    const timing=skill==='send'&&capture.pulses.length?`\n点・線の長さの平均誤差：${Math.round(capture.pulses.reduce((n,p)=>n+p.error,0)/capture.pulses.length*100)}%（区切りのリズムは未採点）`:'';
    $('feedback').textContent=(errors.length?`復習ポイント：${errors.join('、')}`:'次も、同じリズムで。')+timing+(assisted?'\n補助ありの結果は習得判定とテストの得点には含めません。':'');
    if(quizActive())exam.results.push({accuracy:result.accuracy,exact:result.exact,assisted:result.assisted});
    if(quizActive()&&exam.results.length===10)$('next').textContent='結果を見る →';
    refresh();
  }
  function summary(){
    if(!exam||exam.results.length!==10)return;
    exam.active=false;target=null;
    const clean=exam.results.filter(r=>r.exact&&!r.assisted).length,aided=exam.results.filter(r=>r.assisted).length,mean=Math.round(exam.results.reduce((n,r)=>n+r.accuracy,0)/10);
    $('question-area').hidden=true;$('answer-form').hidden=true;$('exam-intro').hidden=false;$('exam-start').textContent='もう一度、10問に挑戦';
    $('result').hidden=false;$('result').dataset.error='false';$('result').textContent=`テスト終了\n補助なし完全一致 ${clean} / 10問\n文字正確率の平均 ${mean}% · 補助あり ${aided}問\n公的資格の合否を判定するものではありません。`;
    notify('10問の結果を記録しました。苦手な文字は通常練習で復習できます。');refresh();
  }
  async function aiExchange(examMode=false){
    const cfg=aiOptions(),mode=settings().mode,ownCode=code();
    if(!examMode&&!ownCode)throw new Error('モールス信号を入力してください。');
    // Validate both the human message and its playback before any model call.
    const own=examMode?null:decodeCode(ownCode,mode).text,segments=examMode?null:trainingSegments(ownCode,settings());
    await perform(async current=>{
      await player.ready();if(!current())return;
      if(!examMode){
        notify('入力したモールスを再生しています。');const complete=await player.play(segments);if(!current()||!complete)return;
        addLog('user',own);resetInput();
      }
      notify('指定したAIが返信を生成しています。停止はいつでも押せます。');
      const reply=await tutor.exchange(ownCode,cfg,{mode,exam:examMode});if(!current())return;
      setTarget(reply);lastAiBubble=addLog('ai','モールス信号を受信。文字は「答えを見る」で確認できます。');
      notify('AIの返信をモールス音で再生しています。');const complete=await player.play(trainingSegments(reply.code,settings()));
      if(!current()||!complete)return;played=1;notify(examMode?'AIからの信号を聞き取って入力してください。':'AIの返答を受信しました。信号を打って会話を続けられます。');
    });
  }
  function dictionary(){
    $('dictionary').replaceChildren();const mode=settings().mode,table=tableFor(mode),ordered=[...LESSON_ORDER[mode],...Object.keys(table).filter(c=>!LESSON_ORDER[mode].includes(c))];
    for(const char of ordered){
      const button=document.createElement('button');button.type='button';const name=char==='\u3099'?'濁点':char==='\u309a'?'半濁点':char;
      button.setAttribute('aria-label',`${name}のモールス信号を再生`);button.append(Object.assign(document.createElement('strong'),{textContent:name}),Object.assign(document.createElement('span'),{textContent:table[char].replaceAll('.', '·').replaceAll('-', '−')}),Object.assign(document.createElement('small'),{textContent:'タップして聞く'}));
      button.addEventListener('click',()=>perform(async current=>{notify(`${name} を再生中`);const done=await player.play(trainingSegments(table[char],settings()));if(current()&&done)notify(`${name} の再生が終わりました。`);}));$('dictionary').append(button);
    }
  }
  function configure(){
    for(const option of $('effective-wpm').options)option.disabled=Number(option.value)>Number($('char-wpm').value);
    if(Number($('effective-wpm').value)>Number($('char-wpm').value))$('effective-wpm').value=$('char-wpm').value;
    const cfg=settings(),t=trainingTiming(cfg);capture=new KeyCapture(cfg);
    if(cfg.mode!==lastMode){tutor.reset();$('thread').replaceChildren();lastMode=cfg.mode;lastAiBubble=null;}
    $('key-help').textContent=`短点 ${Math.round(t.unit*1000)}ms / 長点 ${Math.round(t.unit*3000)}ms。Spaceでも操作。文字間は自動、単語間は「単語区切り」。入力欄のSpaceは通常の文字入力です。`;
    $('scope').textContent=`練習範囲：${alphabet(cfg.mode,cfg.count).join(' ')}。文字速度は点・線、実効速度は文字間の待ち時間を含む速さ（WPM）。AI交信は全ての対応文字を使用します。`;
    stats();
  }
  function navigate(next){
    stop('');exam=null;page=next;target=null;lastAiBubble=null;resetInput();$('result').hidden=true;$('feedback').textContent='';
    const titles={home:['LET’S FIND YOUR RHYTHM','今日も、ひとつの信号から。'],listen:['LISTEN & LEARN','音で、リズムを覚える。'],send:['TAP & SEND','指で、言葉を届ける。'],chat:['A CONVERSATION IN SIGNALS','AIと、モールスで話そう。'],exam:['CHECK YOUR PROGRESS','今の自分を、確かめる。'],dictionary:['YOUR SIGNAL LIBRARY','ひとつの文字、ひとつの音。']};
    if(!Object.hasOwn(titles,next))return;
    $('eyebrow').textContent=titles[next][0];$('title').textContent=titles[next][1];
    for(const button of root.querySelectorAll('[data-page]')){if(button.dataset.page===next)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
    $('round').textContent=next==='chat'?'AI · 1台で練習':next==='exam'?'10問の聞き取り':'自分のペースで';
    $('home').hidden=next!=='home';$('work').hidden=next==='home';$('dictionary').hidden=next!=='dictionary';$('exercise').hidden=next==='dictionary';
    $('chat-tools').hidden=next!=='chat';$('exam-intro').hidden=next!=='exam';$('question-area').hidden=next==='chat'||next==='exam';$('answer-form').hidden=next!=='listen';
    $('key-panel').hidden=next!=='send'&&!(next==='chat'&&!isAIExam());$('compose-tools').hidden=next!=='chat';$('voice').hidden=!hasNative();
    $('ai-question').hidden=!isAIExam();$('send').textContent=next==='chat'?'モールスでAIへ送信':'打った信号を採点';
    $('kind').textContent={listen:'LISTENING PRACTICE',send:'SENDING PRACTICE',chat:'AI MORSE PRACTICE',exam:'10 QUESTION SELF TEST'}[next]||'SIGNAL LIBRARY';
    $('context-note').textContent=next==='chat'?'この端末内での練習です。別端末への音響通信や無線送信ではありません。':'練習の出題・採点はAIなしで動きます。';
    configure();if(next==='listen'||next==='send')newQuestion();if(next==='dictionary')dictionary();refresh();$('title').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});
  }
  function open(){
    if(!canOpen()){launch.textContent='通信・モデル処理を停止してから学習モードを開いてください。';return;}
    previousFocus=document.activeElement;root.hidden=false;document.body.classList.add('academy-open');
    for(const child of document.body.children)if(child!==root&&child.tagName!=='SCRIPT'&&child.tagName!=='STYLE'){inertBefore.set(child,child.inert);child.inert=true;}
    navigate('home');
  }
  function close(settingsPage=false){
    stop('');tutor.stop();root.hidden=true;document.body.classList.remove('academy-open');
    for(const [child,value] of inertBefore)child.inert=value;inertBefore.clear();
    onClose();if(settingsPage){if(onSettings)onSettings();else {document.getElementById('connection-settings')?.scrollIntoView();document.getElementById('model')?.focus();}}
    else previousFocus?.focus();
  }
  function safe(action){return event=>{try{const result=action(event);if(result?.catch)result.catch(error=>notify(error.message,true));}catch(error){notify(error.message,true);}};}
  launch.addEventListener('click',open);$('exit').addEventListener('click',()=>close());$('settings').addEventListener('click',()=>close(true));
  root.querySelectorAll('[data-page],[data-start]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.page||button.dataset.start)));
  $('stop').addEventListener('click',()=>stop());$('play').addEventListener('click',safe(playTarget));$('reveal').addEventListener('click',reveal);
  $('next').addEventListener('click',()=>{if(quizActive()&&exam.results.length===10)summary();else newQuestion();});
  for(const id of ['mode','count','char-wpm','effective-wpm'])$(id).addEventListener('change',safe(()=>{stop('');configure();if(page==='listen'||page==='send')newQuestion();else if(page==='dictionary')dictionary();else {target=null;resetInput();$('question-area').hidden=true;$('answer-form').hidden=true;refresh();}}));
  $('answer-form').addEventListener('submit',safe(event=>{event.preventDefault();if(played===0)return;evaluate($('answer').value,'listen');}));
  $('exam-start').addEventListener('click',()=>{exam={active:true,results:[]};$('exam-intro').hidden=true;newQuestion();});
  $('ai-question').addEventListener('click',safe(()=>aiExchange(true)));
  $('chat-mode').addEventListener('change',()=>{navigate('chat');});
  $('chat-reset').addEventListener('click',()=>{tutor.reset();$('thread').replaceChildren();navigate('chat');notify('会話履歴を消去しました。AIへ自動で送信はしません。');});
  $('send').addEventListener('click',safe(()=>{
    letter();if(page==='chat')return aiExchange(false);
    if(!code())throw new Error('信号を打ってから採点してください。');evaluate(decodeCode(code(),settings().mode,{strict:false}).text,'send');
  }));
  $('dot').addEventListener('click',()=>appendMark('.',true));$('dash').addEventListener('click',()=>appendMark('-',true));$('letter').addEventListener('click',letter);$('word').addEventListener('click',word);
  $('back').addEventListener('click',()=>{clearTimeout(keyTimer);buffer=buffer.trimEnd().slice(0,-1);updateInput();});$('clear').addEventListener('click',resetInput);
  function press(){
    if(busy||root.hidden||!(page==='send'||(page==='chat'&&!isAIExam())))return;
    clearTimeout(keyTimer);if(!capture.press(performance.now()))return;
    $('key').dataset.down='true';player.keyDown().catch(error=>{cancelKey();notify(error.message,true);});
    holdTimer=setTimeout(()=>{cancelKey();notify('長押しが続いたため停止しました。短く区切って打ってください。',true);},2000);
  }
  function release(cancelled=false){
    clearTimeout(holdTimer);holdTimer=null;
    const pulse=capture.release(performance.now(),{cancelled});player.stop();$('key').dataset.down='false';activePointer=null;
    if(!pulse)return;if(pulse.invalid){notify('押した長さが範囲外です。点・線を短く打ち直してください。',true);return;}
    appendMark(pulse.mark);keyTimer=setTimeout(letter,trainingTiming(settings()).gapUnit*3000);
  }
  $('key').addEventListener('pointerdown',event=>{if(event.button!==0||activePointer!==null||busy)return;event.preventDefault();activePointer=event.pointerId;$('key').setPointerCapture(event.pointerId);press();});
  $('key').addEventListener('pointerup',event=>{if(event.pointerId===activePointer){event.preventDefault();release();}});
  for(const type of ['pointercancel','lostpointercapture'])$('key').addEventListener(type,event=>{if(event.pointerId===activePointer)release(true);});
  const editable=element=>element?.closest('input,textarea,select,[contenteditable=true],button:not(#ac-key)');
  document.addEventListener('keydown',event=>{
    if(root.hidden)return;if(event.key==='Escape'){event.preventDefault();stop();return;}
    if(event.code!=='Space'||editable(event.target)||!(page==='send'||(page==='chat'&&!isAIExam())))return;
    event.preventDefault();if(!event.repeat)press();
  });
  document.addEventListener('keyup',event=>{if(!root.hidden&&event.code==='Space'&&capture.started!==null){event.preventDefault();release();}});
  addEventListener('blur',()=>{if(capture.started!==null)release(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!root.hidden)stop('画面が非表示になったため、音とAIを停止しました。');});
  addEventListener('pagehide',()=>{if(!root.hidden)stop('');});
  $('compose-code').addEventListener('click',safe(()=>{const value=encodeText($('compose').value,settings().mode);if([...value.normalized].length>64)throw new Error('文章は64文字以内です。');buffer=value.code+' ';assisted=true;updateInput();notify(`変換結果を確認してください：${value.normalized}。まだAIへ送信していません。`);}));
  $('voice').addEventListener('click',()=>perform(async current=>{
    notify('端末内で音声を認識しています。');const value=await nativeCall('recognize',{language:settings().mode==='wabun'?'ja-JP':'en-US'},30000);
    if(!current())return;$('compose').value=value.text;notify('認識結果を確認し、必要なら修正してから「符号へ変換」を押してください。AIへは未送信です。');
  }));
  $('save').addEventListener('click',safe(async()=>{
    const text=JSON.stringify(progress,null,2),filename='MorseTalk-learning.json';
    if(hasNative()){
      const bytes=new TextEncoder().encode(text);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      await nativeCall('saveFile',{filename,mime:'application/json',base64:btoa(binary)},180000);
    }else{
      const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }));
  stats();if(startOpen)open();
  return {setLocked(value){launch.disabled=Boolean(value);},open,close};
}
