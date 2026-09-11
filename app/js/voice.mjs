let callId=0;const waiting=new Map();
addEventListener('morsetalk-native-result',event=>{
  const d=event.detail,call=waiting.get(d?.id);if(!call)return;
  waiting.delete(d.id);clearTimeout(call.timer);
  if(d.ok)call.resolve(d.result);else call.reject(new Error(d.error||'端末内の音声処理に失敗しました。'));
});
export function hasNative(){return typeof globalThis.NativeBridge?.request==='function';}
export function nativeCall(method,params={},timeout=30000){
  if(!hasNative())return Promise.reject(new Error('Androidブリッジがありません。'));
  const id=`c${++callId}`;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('端末内の処理がタイムアウトしました。'));},timeout);
    waiting.set(id,{resolve,reject,timer});
    try{globalThis.NativeBridge.request(JSON.stringify({id,method,params}));}
    catch(error){clearTimeout(timer);waiting.delete(id);reject(error);}
  });
}
function token(){return document.querySelector('meta[name="morsetalk-token"]')?.content||'';}
export async function capabilities(){
  if(hasNative())return nativeCall('capabilities');
  if(location.protocol==='http:'||location.protocol==='https:'){
    try{
      const r=await fetch('/api/capabilities',{headers:{'X-MorseTalk-Token':token()},signal:AbortSignal.timeout(3000)});
      if(r.ok&&r.headers.get('content-type')?.includes('application/json'))return await r.json();
    }catch{}
  }
  return {platform:'browser',offlineSpeech:false,description:'音声入力はAndroidアプリ / Windowsランチャーで利用できます。文字入力・モールス送受信はこの画面でも使えます。'};
}
export async function transcribeWav(wav,language,signal){
  const r=await fetch(`/api/transcribe?language=${encodeURIComponent(language)}`,{
    method:'POST',body:wav,headers:{'Content-Type':'audio/wav','X-MorseTalk-Token':token()},signal
  });
  let result;try{result=await r.json();}catch{throw new Error('音声認識サーバーの応答を読めませんでした。Windowsランチャーから開いてください。');}
  if(!r.ok)throw new Error(result.error||'音声認識に失敗しました。');
  if(typeof result.text!=='string'||!result.text.trim())throw new Error('言葉を認識できませんでした。マイク・言語設定を確認して、もう一度話してください。');
  return result.text;
}
let currentSpeech=null,speechGeneration=0;
async function localVoices(){
  if(!globalThis.speechSynthesis)return [];
  let voices=speechSynthesis.getVoices();if(voices.length)return voices;
  await new Promise(resolve=>{
    const finish=()=>{speechSynthesis.removeEventListener('voiceschanged',finish);clearTimeout(timer);resolve();};
    const timer=setTimeout(finish,1200);speechSynthesis.addEventListener('voiceschanged',finish,{once:true});
  });
  return speechSynthesis.getVoices();
}
export async function speak(text,language='ja-JP'){
  if(typeof text!=='string'||!text.trim())throw new Error('読み上げる文章がありません。');
  if(text.length>2000)throw new Error('読み上げる文章が長すぎます。');
  stopSpeech();const generation=speechGeneration;
  if(hasNative())return nativeCall('speak',{text,language},90000);
  const voices=await localVoices();if(generation!==speechGeneration)return;
  const voice=voices.find(v=>v.localService&&v.lang.replace('_','-')===language)||voices.find(v=>v.localService&&v.lang.startsWith(language.slice(0,2)));
  if(!voice)throw new Error('指定言語のオフライン読み上げ音声が見つかりません。OSの音声設定で日本語 / 英語の音声を追加してください。文字の受信は完了しています。');
  return new Promise((resolve,reject)=>{
    const utterance=new SpeechSynthesisUtterance(text);utterance.voice=voice;utterance.lang=language;utterance.rate=1;
    const timer=setTimeout(()=>{stopSpeech();reject(new Error('読み上げがタイムアウトしました。'));},90000);
    const cleanup=()=>{clearTimeout(timer);if(currentSpeech?.utterance===utterance)currentSpeech=null;};
    utterance.onend=()=>{cleanup();resolve();};utterance.onerror=e=>{cleanup();if(e.error==='canceled'||e.error==='interrupted')resolve();else reject(new Error(`読み上げに失敗しました：${e.error}`));};
    currentSpeech={utterance,resolve,timer};speechSynthesis.speak(utterance);
  });
}
export function stopSpeech(){
  ++speechGeneration;
  if(currentSpeech){clearTimeout(currentSpeech.timer);currentSpeech.resolve();currentSpeech=null;}
  globalThis.speechSynthesis?.cancel();
  if(hasNative())nativeCall('stopSpeech',{},1000).catch(()=>{});
}
export function cancelNativeRecognition(){if(hasNative())nativeCall('cancelRecognition',{},1000).catch(()=>{});}
export function setAwake(enabled){if(hasNative())nativeCall('setAwake',{enabled},1000).catch(()=>{});}
