import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function requestReading(request,python){
  if(!python)return Promise.resolve(null);
  return new Promise(resolve=>{
    const child=spawn(python,['-X','utf8',fileURLToPath(new URL('./japanese_reading.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','ignore']});
    let output='',settled=false;
    child.stdout.setEncoding('utf8');
    const done=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{child.kill();done(null);},3000);
    child.on('error',()=>done(null));child.stdin.on('error',()=>done(null));
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>12000){child.kill();done(null);}});
    child.on('close',()=>{try{const data=JSON.parse(output);done(typeof data.reading==='string'?data:null);}catch{done(null);}});
    child.stdin.end(JSON.stringify(request));
  });
}
export async function dictionaryReading(text,python){return (await requestReading({text},python))?.reading??null;}
export function dictionaryFormat(text,proposal,python){return requestReading({mode:'format',text,proposal},python);}
