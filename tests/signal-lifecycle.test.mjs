import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {ReadingConnection} from '../app/js/reading-connection.mjs';
import fs from 'node:fs/promises';

const source=(await fs.readFile(new URL('../app/js/signal-app.mjs',import.meta.url),'utf8'))
  .replace(/^import .*;\n/gm,'').replaceAll('import.meta.url',"'http://signal.test/js/signal-app.mjs'");
const tick=()=>new Promise(r=>setImmediate(r));
function setup(extra={}){
  const elements=new Map(),sockets=[],audios=[],listeners=new Map();
  const values={role:'0',speed:'20',volume:'70',topic:'音楽の話'};
  const el=id=>{
    if(!elements.has(id))elements.set(id,{value:values[id]??'',textContent:'',disabled:false,hidden:false,dataset:{},style:{},clientWidth:400,
      classList:{contains:()=>false,add(){},remove(){}},getContext:()=>({clearRect(){},fillRect(){}}),append(){},replaceChildren(){},focus(){}});
    return elements.get(id);
  };
  class Socket{
    constructor(){this.readyState=0;sockets.push(this);}
    open(){this.readyState=1;this.onopen?.();}
    close(){this.readyState=3;this.onclose?.();}
    send(){}
  }
  class Audio{
    constructor(){this.ctx={sampleRate:48000};this.options={};audios.push(this);}
    start(){return new Promise((resolve,reject)=>{this.ready=resolve;this.fail=reject;});}
    stop(){this.stopped=true;}
  }
  class Message{constructor(element){this.element=element;}reset(){}waiting(){}hide(){}interrupt(){}}
  class Chat{reset(){}stop(){}}
  class Link{close(){this.closed=true;}}
  const document={getElementById:el,addEventListener:(n,f)=>listeners.set(n,f),hidden:false};
  const context=vm.createContext({document,window:{dispatchEvent(){},addEventListener:(n,f)=>listeners.set(n,f)},
    localStorage:{getItem:()=>null,setItem(){}},performance:{now:()=>0},requestAnimationFrame:()=>1,cancelAnimationFrame(){},
    ReadingConnection,CustomEvent:class{},InlineMessage:Message,AckMessage:Message,SignalChat:Chat,WebSocket:Socket,FastAudio:Audio,
    ReliableMorseLink:Link,MorseAgent:class{stop(){}},kanaToWire:()=>({wire:'JU'}),packPhonetic:()=>'',
    phoneticPcm:()=>({seconds:1,segments:[]}),phoneticSegments:()=>({segments:[]}),durationOf:()=>1,
    nativeCall:async()=>({}),hasNative:()=>true,setAwake(){},setTimeout,clearTimeout,URL,AbortController,...extra});
  vm.runInContext(source,context);
  return {el,sockets,audios,document,listeners,run:code=>vm.runInContext(code,context)};
}

test('Signal locks configuration immediately and ignores repeated receive starts',async()=>{
  const h=setup();const first=h.run('listen()');
  const second=h.run('listen()');
  try{assert.equal(h.sockets.length,1);assert.equal(h.el('listen').disabled,true);assert.equal(h.el('stop').disabled,false);assert.equal(h.el('role').disabled,true);}
  finally{h.run('stop()');for(const s of h.sockets)s.open();await Promise.all([first,second]);}
});
test('Signal stop during connection cannot open a microphone later',async()=>{
  const h=setup();const first=h.run('listen()');h.run('stop()');h.sockets[0].open();await tick();
  try{assert.equal(h.audios.length,0);}
  finally{h.run('stop()');h.audios.forEach(a=>a.ready());await first;}
});
test('A late microphone failure from an old Signal session preserves the restarted session',async()=>{
  const h=setup();const first=h.run('listen()');h.sockets[0].open();await tick();
  h.run('stop()');const second=h.run('listen()');h.sockets[1].open();await tick();
  h.audios[1].ready();await second;h.audios[0].fail(Error('old permission failure'));await first;
  try{assert.notEqual(h.audios[1].stopped,true);assert.equal(h.el('state').textContent,'マイク受信中');}
  finally{h.run('stop()');}
});
test('Signal rejects an empty topic before opening any connection',async()=>{
  const h=setup();h.el('topic').value='  ';const p=h.run('listen()');
  try{assert.equal(h.sockets.length,0);}
  finally{h.run('stop()');h.sockets.forEach(s=>s.open());await tick();h.audios.forEach(a=>a.ready());await p;}
});
test('Signal visibility loss stops the active microphone',async()=>{
  const h=setup();const p=h.run('listen()');h.sockets[0].open();await tick();h.audios[0].ready();await p;
  h.document.hidden=true;h.listeners.get('visibilitychange')?.();
  try{assert.equal(h.audios[0].stopped,true);}
  finally{h.run('stop()');}
});
