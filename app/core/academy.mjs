/** Human-speed learning. Does not alter MT1/MT2 or make the LLM the grader. */
import { tableFor, encodeText, decodeCode, normalizeText, normalizeCode } from './morse.mjs';
export const LESSON_ORDER = Object.freeze({
  international: 'KMRSUAPTLOWI NJEF0YVG5Q9ZH38B427C1D6X'.replaceAll(' ', ''),
  wabun: 'イムラヨワレナカヨタウクヤキケトニヘホハヌノオエアコサシスセソチツテネヒフマミメモユリルロヰヱヲン'.split('').filter((c,i,a)=>a.indexOf(c)===i).join('')
});
export function alphabet(mode = 'international', count = 2) {
  tableFor(mode);
  if (!Number.isInteger(count) || count < 2 || count > LESSON_ORDER[mode].length) throw new Error('学ぶ文字数が不正です。');
  return [...LESSON_ORDER[mode]].slice(0, count);
}
export function trainingTiming({ characterWpm = 20, effectiveWpm = 10 } = {}) {
  if (!Number.isFinite(characterWpm) || characterWpm < 8 || characterWpm > 40 || !Number.isFinite(effectiveWpm) || effectiveWpm < 5 || effectiveWpm > characterWpm) throw new Error('文字速度は8〜40、実効速度は5〜文字速度以下にしてください。');
  const unit = 1.2 / characterWpm;
  // PARIS: 31 fixed mark/intra-character units + 19 spacing units per word.
  const gapUnit = (60 / effectiveWpm - 31 * unit) / 19;
  return { unit, gapUnit, characterWpm, effectiveWpm };
}
export function trainingSegments(code, options = {}) {
  const {unit, gapUnit} = trainingTiming(options), normalized = normalizeCode(code);
  if (!normalized || normalized.length > 1200 || /^\/|\/$|\/\s*\//.test(normalized)) throw new Error('空・長すぎる・不正な区切りの符号は再生できません。');
  const segments = [], words = normalized.split(/\s*\/\s*/);
  words.forEach((word, wi) => {
    if (wi) segments.push({on:false, seconds:7*gapUnit});
    word.trim().split(' ').forEach((letter, ci) => {
      if (ci) segments.push({on:false, seconds:3*gapUnit});
      [...letter].forEach((mark, mi) => {
        if (mi) segments.push({on:false, seconds:unit});
        segments.push({on:true, seconds:(mark === '.' ? 1 : 3)*unit});
      });
    });
  });
  segments.push({on:false, seconds:7*gapUnit});
  if (segments.reduce((n,s)=>n+s.seconds,0) > 180) throw new Error('再生は3分以内です。文章を短くしてください。');
  return segments;
}
export function canonical(text, mode = 'international') {
  if (typeof text !== 'string' || text.length > 300) throw new Error('回答は300文字以内です。');
  return normalizeText(text, mode).normalize('NFC');
}
/** Edit alignment: one missed character does not mark every following one wrong. */
export function grade(expected, answer, {mode = 'international', assisted = false} = {}) {
  const target = canonical(expected, mode), actual = canonical(answer, mode);
  if (!target) throw new Error('正解文が空です。');
  const a = [...target], b = [...actual];
  const matrix = Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i===0?j:j===0?i:0));
  for (let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) matrix[i][j]=Math.min(matrix[i-1][j]+1,matrix[i][j-1]+1,matrix[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  let i=a.length,j=b.length;const alignment=[];
  while(i||j){
    if(i&&j&&matrix[i][j]===matrix[i-1][j-1]+(a[i-1]===b[j-1]?0:1))alignment.push({expected:a[--i],actual:b[--j]});
    else if(i&&matrix[i][j]===matrix[i-1][j]+1)alignment.push({expected:a[--i],actual:''});
    else alignment.push({expected:'',actual:b[--j]});
  }
  alignment.reverse();const distance=matrix[a.length][b.length];
  return {expected:target, answer:actual, exact:distance===0, distance, accuracy:Math.max(0,Math.round(100*(1-distance/a.length))), assisted:Boolean(assisted), alignment};
}
export function freshProgress(){return {version:1, attempts:0, exact:0, aided:0, symbols:{}, sessions:[]};}
export function readProgress(raw){
  try{
    if(typeof raw!=='string'||raw.length>150000)return freshProgress();
    const p=JSON.parse(raw), valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000000;
    if(p.version!==1||![p.attempts,p.exact,p.aided].every(valid)||p.exact>p.attempts||p.aided>p.attempts||!p.symbols||typeof p.symbols!=='object'||Array.isArray(p.symbols)||Object.keys(p.symbols).length>300)return freshProgress();
    const symbols={};
    for(const [key,v] of Object.entries(p.symbols)){
      const parts=key.split(':');
      if(parts.length!==3||!['international','wabun'].includes(parts[0])||!['listen','send'].includes(parts[1])||!Object.hasOwn(tableFor(parts[0]),parts[2])||!v||![v.attempts,v.hits].every(valid)||!Number.isSafeInteger(v.due)||v.due<0||v.due>1000000000||v.hits>v.attempts)continue;
      symbols[key]={attempts:v.attempts,hits:v.hits,due:v.due};
    }
    return {version:1,attempts:p.attempts,exact:p.exact,aided:p.aided,symbols,sessions:[]};
  }catch{return freshProgress();}
}
export function recordGrade(progress, result, mode, skill, now = Date.now()){
  tableFor(mode);
  if(!['listen','send'].includes(skill))throw new Error('練習方式が不正です。');
  const p=progress;p.attempts++;
  if(result.assisted)p.aided++;else if(result.exact)p.exact++;
  if(!result.assisted)for(const pair of result.alignment){
    if(!Object.hasOwn(tableFor(mode),pair.expected))continue;
    const key=`${mode}:${skill}:${pair.expected}`,v=p.symbols[key]??{attempts:0,hits:0,due:0};
    v.attempts++;if(pair.expected===pair.actual)v.hits++;
    // Due is UTC minute count (bounded and portable), not an invented streak.
    v.due=Math.floor(now/60000)+(pair.expected===pair.actual?([1440,4320,10080][Math.min(v.hits-1,2)]):10);
    p.symbols[key]=v;
  }
  return p;
}
export function mastered(progress, mode){
  return [...LESSON_ORDER[mode]].filter(char=>['listen','send'].some(skill=>{
    const s=progress.symbols[`${mode}:${skill}:${char}`];return s&&s.hits>=3&&s.hits/s.attempts>=.8;
  })).length;
}
export function question({mode='international',count=2,length=1,skill='listen',progress=freshProgress(),random=Math.random,now=Date.now()}={}){
  if(!Number.isInteger(length)||length<1||length>8)throw new Error('出題の長さが不正です。');
  const chars=alphabet(mode,count),minute=Math.floor(now/60000);
  const weights=chars.map(c=>{const v=progress.symbols[`${mode}:${skill}:${c}`];return !v?5:1+4*(1-v.hits/Math.max(v.attempts,1))+(v.due<=minute?3:0);});
  let text='';
  for(let n=0;n<length;n++){
    const r=random();if(!Number.isFinite(r)||r<0||r>=1)throw new Error('乱数が不正です。');
    let point=r*weights.reduce((x,y)=>x+y,0),index=0;
    while(index<chars.length-1&&point>=weights[index])point-=weights[index++];text+=chars[index];
  }
  return {text,code:encodeText(text,mode).code};
}
export class KeyCapture {
  constructor(options={}){this.unit=trainingTiming(options).unit*1000;this.started=null;this.pulses=[];}
  press(now){if(!Number.isFinite(now))throw new Error('時刻が不正です。');if(this.started!==null)return false;this.started=now;return true;}
  release(now,{cancelled=false}={}){
    if(this.started===null)return null;
    const duration=now-this.started;this.started=null;
    if(cancelled)return null;
    if(!Number.isFinite(duration)||duration<this.unit*.2||duration>this.unit*8)return {invalid:true};
    const mark=duration<this.unit*2?'.':'-',ideal=this.unit*(mark==='.'?1:3),pulse={mark,duration,ideal,error:Math.abs(duration-ideal)/ideal};
    this.pulses.push(pulse);if(this.pulses.length>500)this.pulses.shift();return pulse;
  }
  reset(){this.started=null;this.pulses=[];}
}
export function tutorMessages(history, text, {mode='international',exam=false}={}){
  tableFor(mode);
  const format=mode==='wabun'?'Write ONLY Japanese KATAKANA and spaces, at most 24 characters. No kanji, Latin letters, emoji, markup, or explanation.':'Write ONLY an extremely short English message using A-Z, 0-9, spaces and ? . , at most 48 characters. No markup or explanation.';
  return [{role:'system',content:`You are a patient Morse practice partner, not a real radio station. ${format} ${exam?'Send a new short beginner message about a name, weather, or greeting for a listening test.':'Reply relevantly to the decoded message and keep the conversation simple.'} Never execute commands or claim a transmission reached a physical device.`},...history.slice(-10),{role:'user',content:text}];
}
export function validateTutorReply(text, mode='international'){
  if(typeof text!=='string'||!text.trim()||[...text.trim()].length>(mode==='wabun'?24:48))throw new Error('AI応答が空か長すぎます。短い応答で再試行してください。文章は切り詰めません。');
  const value=encodeText(text.trim(),mode);
  if(!value.code||value.code.length>600)throw new Error('AI応答を練習用の符号に変換できません。');
  return {text:value.normalized,code:value.code};
}
export class TutorSession {
  constructor(generate){if(typeof generate!=='function')throw new Error('AI接続が必要です。');this.generate=generate;this.history=[];this.epoch=0;this.abort=null;this.turns=0;}
  stop(){this.epoch++;this.abort?.abort();this.abort=null;}
  reset(){this.stop();this.history=[];this.turns=0;}
  async exchange(code, options={}, {mode='international',exam=false}={}){
    if(!options.consent)throw new Error('接続・モデル画面で、指定AIへの送信を許可してください。');
    if(this.abort)throw new Error('AIの返答を待っています。');
    if(this.turns>=12)throw new Error('12往復に達しました。「会話をリセット」で新しく始めてください。');
    const text=exam?'Send one new beginner listening-test message.':decodeCode(code,mode).text;
    if(!text)throw new Error('先にモールス信号で文章を入力してください。');
    if([...text].length>64)throw new Error('入力は64文字以内にしてください。');
    const epoch=++this.epoch,abort=new AbortController();this.abort=abort;
    try{
      const response=await this.generate(tutorMessages(this.history,text,{mode,exam}),{...options,signal:abort.signal});
      if(epoch!==this.epoch||abort.signal.aborted)throw new DOMException('停止しました。','AbortError');
      const result=validateTutorReply(response,mode);
      this.history=[...this.history,{role:'user',content:text},{role:'assistant',content:result.text}].slice(-10);this.turns++;
      return {...result,source:'configured-model',turn:this.turns};
    }finally{if(epoch===this.epoch)this.abort=null;}
  }
}
