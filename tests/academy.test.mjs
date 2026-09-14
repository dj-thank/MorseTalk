import test from 'node:test';
import assert from 'node:assert/strict';
import { INTERNATIONAL, WABUN, encodeText, decodeCode } from '../app/core/morse.mjs';
import { LESSON_ORDER, alphabet, trainingTiming, trainingSegments, grade, freshProgress, readProgress, recordGrade, mastered, question, KeyCapture, validateTutorReply, TutorSession } from '../app/core/academy.mjs';
const sum=s=>s.reduce((n,x)=>n+x.seconds,0),enc=t=>encodeText(t).code;
for(const mode of ['international','wabun']){
  test(`${mode}: curriculum covers the alphabet once`,()=>{
    const order=LESSON_ORDER[mode];assert.equal(new Set(order).size,order.length);
    const expected=mode==='international'?[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789']:Object.keys(WABUN).filter(c=>/^[ァ-ン]$/.test(c));
    assert.deepEqual([...order].sort(),expected.sort());
    for(const c of order)assert.equal(decodeCode(encodeText(c,mode).code,mode).text,c);
  });
  test(`${mode}: questions stay inside selected lesson`,()=>{
    for(const count of [2,4,8,16,LESSON_ORDER[mode].length])for(const r of [0,.2,.5,.999999]){
      const q=question({mode,count,length:8,random:()=>r});assert.equal(q.text.length,8);
      assert([...q.text].every(c=>alphabet(mode,count).includes(c)));assert.equal(decodeCode(q.code,mode).text,q.text);
    }
  });
}
for(const charWpm of [8,12,20,40])for(const effectiveWpm of [5,charWpm])test(`PARIS timing ${charWpm}/${effectiveWpm}`,()=>{
  const segments=trainingSegments(enc('PARIS'),{characterWpm:charWpm,effectiveWpm});assert(Math.abs(sum(segments)-60/effectiveWpm)<1e-9);
  const t=trainingTiming({characterWpm:charWpm,effectiveWpm});assert(t.gapUnit>=t.unit-1e-10);
  const e=trainingSegments('. -',{characterWpm:charWpm,effectiveWpm});assert.equal(e[0].seconds,t.unit);assert.equal(e[1].seconds,3*t.gapUnit);assert.equal(e[2].seconds,3*t.unit);
});
for(const invalid of ['', '/', '/ .', '. /', '. / / -', 'x', '.'.repeat(1201)])test(`reject invalid playback ${invalid.slice(0,12)}`,()=>assert.throws(()=>trainingSegments(invalid)));
for(const spec of [{characterWpm:7},{effectiveWpm:0},{effectiveWpm:21},{characterWpm:NaN},{characterWpm:Infinity},{effectiveWpm:-1}])test(`reject timing ${JSON.stringify(spec)}`,()=>assert.throws(()=>trainingTiming(spec)));
test('word gap is seven, not additive with character gaps',()=>{
 const s=trainingSegments(enc('E E'),{characterWpm:20,effectiveWpm:20});assert.deepEqual(s.map(x=>[x.on,Math.round(x.seconds/.06)]),[[true,1],[false,7],[true,1],[false,7]]);
});
for(const [expected,answer,distance] of [['ABC','AC',1],['ABC','AXBC',1],['ABC','AXC',1],['ABC','',3],['E','EEEE',3]])test(`edit alignment ${expected}/${answer}`,()=>{
 const g=grade(expected,answer);assert.equal(g.distance,distance);assert.equal(g.exact,distance===0);assert(g.accuracy>=0&&g.accuracy<=100);
 assert.equal(g.alignment.map(p=>p.expected).join(''),expected);assert.equal(g.alignment.map(p=>p.actual).join(''),answer);
});
test('normalizes full-width English and Wabun dakuten',()=>{assert(grade('HELLO','ｈｅｌｌｏ').exact);assert(grade('ガッコウ','がっこう',{mode:'wabun'}).exact);});
test('empty target and oversized answers rejected',()=>{assert.throws(()=>grade('','A'));assert.throws(()=>grade('A','X'.repeat(301)));});
for(const raw of [null,'not json','null','{}','{"version":2}',JSON.stringify({...freshProgress(),exact:1}),JSON.stringify({...freshProgress(),symbols:[]}),JSON.stringify({...freshProgress(),attempts:-1}),' '.repeat(150001)])test(`corrupt progress resets ${String(raw).slice(0,28)}`,()=>assert.deepEqual(readProgress(raw),freshProgress()));
test('current-date progress survives serialization with review due date',()=>{
 const p=freshProgress();recordGrade(p,grade('K','K'),'international','listen',Date.UTC(2026,8,12));assert.deepEqual(readProgress(JSON.stringify(p)),p);
 assert(p.symbols['international:listen:K'].due>10000000);
});
test('aided answers cannot inflate clean mastery or clean accuracy',()=>{
 const p=freshProgress();for(let i=0;i<20;i++)recordGrade(p,grade('K','K',{assisted:true}),'international','listen');assert.equal(mastered(p,'international'),0);assert.equal(p.exact,0);assert.equal(p.aided,20);
 for(let i=0;i<3;i++)recordGrade(p,grade('K','K'),'international','listen');assert.equal(mastered(p,'international'),1);
});
test('missing characters update only aligned symbols',()=>{const p=freshProgress();recordGrade(p,grade('KMR','KR'),'international','listen');assert.equal(p.symbols['international:listen:M'].hits,0);assert.equal(p.symbols['international:listen:R'].hits,1);});
test('ignores injected or unknown progress keys',()=>{const p=freshProgress();p.symbols['__proto__']={hits:9};p.symbols['international:listen:fake']={attempts:3,hits:3,due:0};assert.deepEqual(readProgress(JSON.stringify(p)),freshProgress());assert.equal({}.hits,undefined);});
test('bad random, alphabet and length inputs rejected',()=>{for(const random of [()=>NaN,()=>1,()=>-.1])assert.throws(()=>question({random}));assert.throws(()=>alphabet('x'));assert.throws(()=>alphabet('international',100));assert.throws(()=>question({length:0}));});
test('mistakes and due dates affect the sampling weight',()=>{
 const p=freshProgress();p.symbols['international:listen:K']={attempts:5,hits:5,due:999999999};p.symbols['international:listen:M']={attempts:5,hits:0,due:0};
 assert.equal(question({progress:p,random:()=>.3}).text,'M');assert.equal(question({random:()=>.3}).text,'K');
});
test('straight key classifies dots and dashes at character speed',()=>{
 const k=new KeyCapture({characterWpm:20,effectiveWpm:5});assert(k.press(100));assert.equal(k.press(101),false);assert.equal(k.release(160).mark,'.');k.press(200);const dash=k.release(380);assert.equal(dash.mark,'-');assert.equal(dash.error,0);assert.equal(k.release(500),null);
});
test('cancel and invalid holds produce no accidental character',()=>{
 const k=new KeyCapture();k.press(1);assert.equal(k.release(100,{cancelled:true}),null);k.press(200);assert(k.release(201).invalid);k.press(300);assert(k.release(10000).invalid);assert.equal(k.pulses.length,0);k.press(1000);k.reset();assert.equal(k.release(1100),null);
});
test('validates AI text with real codec, never truncates or translates silently',()=>{
 assert.equal(validateTutorReply('hi?').text,'HI?');assert.equal(validateTutorReply('コンニチハ','wabun').text,'コンニチハ');
 for(const x of ['','A'.repeat(49),'Hello 😀','<script>','안녕'])assert.throws(()=>validateTutorReply(x));assert.throws(()=>validateTutorReply('こんにちは漢字','wabun'));
});
test('configured generator receives decoded Morse and returns encodeable reply (explicit test double)',async()=>{
 let calls=0;const t=new TutorSession(async messages=>{calls++;assert.equal(messages.at(-1).content,'HI');return 'HELLO';});
 const r=await t.exchange(enc('HI'),{consent:true});assert.equal(r.code,enc('HELLO'));assert.equal(r.source,'configured-model');assert.equal(calls,1);assert.equal(t.history.length,2);
});
test('consent failure and bad input never call generator',async()=>{let calls=0;const t=new TutorSession(async()=>{calls++;return 'HI';});await assert.rejects(t.exchange(enc('HI')));await assert.rejects(t.exchange('......',{consent:true}));await assert.rejects(t.exchange('',{consent:true}));assert.equal(calls,0);});
test('invalid model output does not advance the session or invoke fallback',async()=>{let calls=0;const t=new TutorSession(async()=>{calls++;return '🚫';});await assert.rejects(t.exchange(enc('HI'),{consent:true}));assert.equal(calls,1);assert.equal(t.turns,0);assert.deepEqual(t.history,[]);});
test('cancellation ignores late non-cooperating generator output',async()=>{
 let release;const t=new TutorSession(()=>new Promise(r=>release=r));const pending=t.exchange(enc('HI'),{consent:true});t.stop();release('HI');await assert.rejects(pending,{name:'AbortError'});assert.deepEqual(t.history,[]);assert.equal(t.turns,0);
});
test('concurrent exchanges rejected',async()=>{let release;const t=new TutorSession(()=>new Promise(r=>release=r));const p=t.exchange(enc('HI'),{consent:true});await assert.rejects(t.exchange(enc('HI'),{consent:true}));release('HI');await p;});
test('history and turn cap bounded; reset really resets',async()=>{
 const sizes=[];const t=new TutorSession(async m=>{sizes.push(m.length);return 'HI';});for(let i=0;i<12;i++)await t.exchange(enc('HI'),{consent:true});assert.equal(t.history.length,10);assert(Math.max(...sizes)<=12);await assert.rejects(t.exchange(enc('HI'),{consent:true}));t.reset();assert.equal(t.turns,0);assert.deepEqual(t.history,[]);
});
test('exam asks the configured model, not a canned phrase',async()=>{let prompt;const t=new TutorSession(async m=>{prompt=m;return 'RAIN TODAY';});const r=await t.exchange('',{consent:true},{exam:true});assert.match(prompt[0].content,/listening test/);assert.equal(r.text,'RAIN TODAY');});
