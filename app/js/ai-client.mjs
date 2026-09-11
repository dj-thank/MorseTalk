import { hasNative, nativeCall } from './voice.mjs';
function token(){return document.querySelector('meta[name="morsetalk-token"]')?.content||'';}
export async function aiCapabilities(){
  if(hasNative())return {native:true,provider:'ollama',endpoint:'http://127.0.0.1:11434/api/chat',model:'',remote:false};
  if(!['http:','https:'].includes(location.protocol))return {portable:true,description:'単独HTMLでは通信自己診断だけ利用できます。AI接続はStart-AI-Windows.cmd / Androidアプリを使います。'};
  const response=await fetch('/api/ai/capabilities',{headers:{'X-MorseTalk-Token':token()},signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw new Error('AIランチャーから開いてください。');return response.json();
}
export async function generateReply(messages,{model,endpoint,provider='ollama',consent=false,signal}={}){
  if(!consent)throw new Error('AIへ会話文を渡すことを許可してください。');
  if(signal?.aborted)throw new DOMException('停止しました。','AbortError');
  let result;
  if(hasNative()){
    const cancel=()=>{nativeCall('cancelAI',{},1000).catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
    try{result=await nativeCall('aiChat',{messages,model,endpoint,provider,consent},95000);}finally{signal?.removeEventListener('abort',cancel);}
  }else{
    const signals=[AbortSignal.timeout(95000)];if(signal)signals.push(signal);
    const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json','X-MorseTalk-Token':token()},body:JSON.stringify({messages,model,consent}),signal:AbortSignal.any(signals)});
    try{result=await response.json();}catch{throw new Error('AI APIがありません。Start-AI-Windows.cmdから開いてください。');}
    if(!response.ok)throw new Error(result.error||'AI接続エラー');
  }
  if(signal?.aborted)throw new DOMException('停止しました。','AbortError');
  if(typeof result.text!=='string'||!result.text.trim())throw new Error('AI応答が空です。');
  return result.text;
}
