import { connectionCode, parseConnectionCode, newSessionId, importProgress, SessionJournal } from '../core/session-tools.mjs';
import { hasNative, nativeCall } from './voice.mjs';
/** Presentation only. Main controller remains the sole owner of inference and audio. */
export function createExperience({options, changed, error}) {
  const $=id=>document.getElementById(id), journal=new SessionJournal();
  let locked=false, model=null, phase='停止中', timer=null, timeBase=performance.now(), run=false;
  const invoke=(id,fn)=>$(id).addEventListener('click',()=>{try{if(locked)throw new Error('実行中です。先にすべて停止してください。');fn();}catch(e){error(e);}});
  function updateReadiness(){
    const local=hasNative()&&$('provider').value==='litert';
    if($('dialogue-mode')?.value==='manual'){
      const online=$('transport')?.value==='online';
      $('execution-place').textContent='手入力 · AIは呼び出しません';
      $('preflight-model').textContent='モデル不要';
      $('preflight-consent').textContent=online?($('network-consent').checked?'ネット交信を許可済み':'ネット交信の許可が必要'):'AI処理の許可は不要';
      $('preflight-pair').textContent=`端末${$('role').value==='1'?'B':'A'} · ${online?'オンライン':$('speed').value+' WPM'} · ${$('turns').value}ターン`;
      $('readiness').textContent=model?.busy?'モデル処理の終了を待ってから接続してください。':online?'招待を共有して両端でネット交信を許可。B待機 → A待機 → Aから手入力で送信します。':'両端の設定を合わせ、B待機 → A待機 → Aから手入力で送信します。';
      return;
    }
    $('execution-place').textContent=local?'端末内 Gemma 4 E2B':'設定したAIサーバー';
    $('preflight-model').textContent=local ? (!model?'状態確認中':model.busy?'モデル処理中':model.loaded?'読込済み':model.installed?'取り込み済み · 先読み可能':'モデルを取り込む') : 'AI接続テストで確認';
    $('preflight-consent').textContent=$('consent').checked?'AI処理を許可済み':'AI処理の許可が必要';
    $('preflight-pair').textContent=`端末${$('role').value==='1'?'B':'A'} · ${$('speed').value} WPM · ${$('turns').value}ターン`;
    $('readiness').textContent=local && model?.busy ? 'モデル処理の終了待ち。進み具合は下のモデル欄に表示します。' :
      local && model?.installed===false ? 'まず「モデルを取り込む」。通信自己診断はAIなしでも試せます。' :
      !$('consent').checked ? 'AI処理を許可し、AI接続テストで確認してください。' :
      '両端に同じ接続コードを設定し、Bを受信待機 → Aを受信待機 → Aから開始。';
  }
  function tick(){
    $('elapsed').textContent=`${((performance.now()-timeBase)/1000).toFixed(0)} s`;
    $('phase-label').textContent=phase;
    $('turn-count').textContent=`${journal.turns} / ${$('turns').value}`;
    $('retry-count').textContent=String(journal.retries);
  }
  function codeFromSettings(){ $('pairing-code').value=connectionCode(options()); }
  invoke('make-code',codeFromSettings);
  invoke('new-session',()=>{ $('session').value=newSessionId().toString(16).toUpperCase().padStart(8,'0'); codeFromSettings();changed(); });
  invoke('apply-code',()=>{
    const value=parseConnectionCode($('pairing-code').value);
    $('room').value=value.room;$('session').value=value.session.toString(16).toUpperCase().padStart(8,'0');
    $('speed').value=String(value.wpm);$('turns').value=String(value.maxTurns);$('max-bytes').value=String(value.maxReplyBytes);
    $('pairing-code').value=connectionCode(value);changed();
    $('pairing-note').textContent='接続設定を反映しました。A/Bの役割は別々に選んでください。AIの接続先・許可は変更していません。';
  });
  invoke('copy-code',()=>{
    const text=$('pairing-code').value;parseConnectionCode(text);
    const fallback=()=>{$('pairing-code').focus();$('pairing-code').select();$('pairing-note').textContent='コードを選択しました。端末のコピー操作を使ってください。';};
    if(navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(()=>{$('pairing-note').textContent='接続コードをコピーしました。相手のコード欄に貼り付けて適用してください。';},fallback);
    else fallback();
  });
  $('preset').addEventListener('change',()=>{
    if(locked)return;
    const presets={work:['作業計画を一つずつ具体化する。短い日本語一文で、新しい提案を一つ加える。','明日の作業は何から始める？'],ideas:['アイデアを交互に一つずつ出す。短い日本語一文で、同じ提案や相づちを繰り返さない。','散歩を楽しくするアイデアを一つ教えて。'],check:['短い日本語一文で色の名前を一つずつ挙げる。説明や挨拶は不要。','最初の色を一つ教えて。']};
    const preset=presets[$('preset').value];if(preset){$('goal').value=preset[0];$('topic').value=preset[1];}
  });
  $('export-log').addEventListener('click',async()=>{
    try{
      if(locked)throw new Error('ログの保存は停止してから行ってください。');
      const bytes=new TextEncoder().encode(JSON.stringify(journal.export($('include-transcript').checked),null,2));
      const filename='MorseTalk-session.json';
      if(hasNative()){
        let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));
        await nativeCall('saveFile',{filename,mime:'application/json',base64:btoa(text)},180000);
      }else{
        const url=URL.createObjectURL(new Blob([bytes],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    }catch(e){error(e);}
  });
  for(const id of ['role','speed','turns','consent','provider','dialogue-mode','transport','network-consent'])$(id).addEventListener('change',updateReadiness);
  updateReadiness();
  return {
    model(value){model=value;updateReadiness();const p=importProgress(value),bar=$('model-progress');
      $('model-progress-wrap').hidden=value.phase!=='importing';
      if(p.fraction===null)bar.removeAttribute('value');else bar.value=p.fraction;
      const size=n=>(n/1048576).toFixed(0)+' MiB';
      $('model-progress-text').textContent=p.total?`${size(p.bytes)} / ${size(p.total)} · ${Math.floor(p.fraction*100)}%`:`${size(p.bytes)}をコピー済み（全体サイズ不明）`;
      $('model-space').textContent=Number.isFinite(value.freeBytes)?`空き容量 ${(value.freeBytes/1073741824).toFixed(1)} GiB · 元ファイルとアプリ用コピーの両方が必要です。`:'';
    },
    lock(value){locked=value;for(const id of ['make-code','apply-code','copy-code','new-session','pairing-code','preset','export-log','include-transcript'])$(id).disabled=value;updateReadiness();},
    start(mode){journal.reset(mode);timeBase=performance.now();run=true;phase='準備中';clearInterval(timer);timer=setInterval(tick,500);$('elapsed').textContent='0 s';$('inference').textContent='—';$('airtime').textContent='—';tick();},
    stage(value){phase=value;$('phase-label').textContent=value;},
    record(e){journal.record(e);$('turn-count').textContent=`${journal.turns} / ${$('turns').value}`;$('retry-count').textContent=String(journal.retries);},
    finish(){if(run){tick();journal.finish();}run=false;clearInterval(timer);timer=null;},
    clear(){journal.reset('idle');journal.finish();$('turn-count').textContent='0';$('retry-count').textContent='0';$('elapsed').textContent='—';},
    refresh:updateReadiness,
  };
}
