#!/usr/bin/env node
/** Actual, explicitly configured local model. No mock or canned fallback. */
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { TutorSession, trainingSegments, grade } from '../app/core/academy.mjs';
import { encodeText, decodeCode } from '../app/core/morse.mjs';
const model=process.env.MORSETALK_AI_MODEL;
if(!model)throw new Error('Set MORSETALK_AI_MODEL to an installed local model. No automatic model download.');
const endpoint=new URL(process.env.MORSETALK_AI_ENDPOINT||'http://127.0.0.1:11434/api/chat');
if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw new Error('Verification uses a loopback Ollama endpoint only.');
const samples=[];
async function generate(messages,{signal}){
  const start=performance.now();
  // Match the production AIService Ollama contract, including disabled thinking.
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([signal,AbortSignal.timeout(120000)]),body:JSON.stringify({model,messages,stream:false,think:false,keep_alive:'10m',options:{num_ctx:4096,num_predict:96,temperature:0.3}})});
  if(!response.ok)throw new Error(`Model HTTP ${response.status}`);
  const result=await response.json();
  samples.push({messages,reply:result.message?.content,inferenceMs:Math.round(performance.now()-start),doneReason:result.done_reason,generatedTokens:result.eval_count});
  if(typeof result.message?.content!=='string')throw new Error('Missing actual model reply');
  return result.message.content;
}
let error=null;
try{
  for(const mode of ['international','wabun']){
    const tutor=new TutorSession(generate);
    const inputs=mode==='international'?['HI','MY NAME IS K']:['コンニチハ','オゲンキデスカ'];
    for(const text of inputs){
      const reply=await tutor.exchange(encodeText(text,mode).code,{consent:true},{mode});
      assert.equal(decodeCode(reply.code,mode).text,reply.text);
      assert(grade(reply.text,decodeCode(reply.code,mode).text,{mode}).exact);
      assert(trainingSegments(reply.code,{characterWpm:20,effectiveWpm:10}).length>0);
    }
    const reply=await tutor.exchange('',{consent:true},{mode,exam:true});
    assert.equal(reply.source,'configured-model');assert(grade(reply.text,decodeCode(reply.code,mode).text,{mode}).exact);
  }
}catch(e){error=e.message;process.exitCode=1;}
await fs.mkdir('test-results/academy-model',{recursive:true});
const report={model,passed:error===null,samples,error,scope:'Actual local model through TutorSession and Morse codec. No physical audio or Android performance measurement.'};
await fs.writeFile('test-results/academy-model/report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({model,passed:report.passed,requests:samples.length,error}));
