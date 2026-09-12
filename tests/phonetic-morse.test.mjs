import test from 'node:test';import assert from 'node:assert/strict';
import {kanaToWire,wireToKana,packPhonetic,unpackPhonetic,phoneticPcm,PhoneticDecoder} from '../app/core/phonetic-morse.mjs';
test('WA is actual payload for わ; incomplete syllables wait for received letters',()=>{
  assert.equal(kanaToWire('わたし').wire,'WA TA SHI');
  assert.equal(wireToKana('W',{partial:true}).text,'');
  assert.equal(wireToKana('WA',{partial:true}).text,'わ');
  assert.equal(wireToKana('WA T',{partial:true}).text,'わ');
  assert.equal(wireToKana('WA TA',{partial:true}).text,'わた');
  assert.equal(wireToKana('N',{partial:true}).text,'');
  assert.equal(wireToKana('NA',{partial:true}).text,'な');
});
test('Digraphs and small kana round trip without inventing kanji',()=>{
  const text='きょうはちょっとたのしいね。';assert.equal(wireToKana(kanaToWire(text).wire).text,text);
  assert.throws(()=>kanaToWire('今日'));assert.throws(()=>wireToKana('WHAT'));
});
for(const language of ['ja','en'])for(const wpm of [40,60])test(`${language} real PCM ${wpm} WPM produces letters, text and CRC-verified frame`,()=>{
  const wire=language==='ja'?kanaToWire('わたしはおんがくがすき。').wire:'I LIKE MUSIC.';
  const framed=packPhonetic({sender:0,seq:1,wire});const {pcm}=phoneticPcm(framed,{wpm});
  const frames=[],characters=[],errors=[];const d=new PhoneticDecoder({language,wpm,onFrame:f=>frames.push(f),onCharacter:c=>characters.push(c),onError:e=>errors.push(e)});
  for(let i=0;i<pcm.length;i+=128)d.push(pcm.subarray(i,i+128));
  assert.deepEqual(errors,[]);assert.equal(frames.length,1);assert.equal(frames[0].wire,wire);assert.ok(characters.length>5);
  if(language==='ja'){assert.ok(characters.some(e=>e.unit==='WA'&&e.kana==='わ'));assert.equal(frames[0].text,'わたしはおんがくがすき。');}
  else assert.equal(frames[0].text,'I LIKE MUSIC.');
});
test('Corrupted text does not reach the peer even when all Morse characters are valid',()=>{
  const wire=packPhonetic({sender:0,seq:1,wire:'WA TA SHI'}).replace('WA','KA');assert.throws(()=>unpackPhonetic(wire),/CRC/);
});
test('Arbitrary fast tempo is generated at the requested rate and decoding failure is retained',()=>{
  const wire=packPhonetic({sender:0,seq:1,wire:'NA'}),fast=phoneticPcm(wire,{wpm:600}),normal=phoneticPcm(wire,{wpm:60});
  assert.ok(fast.seconds<normal.seconds);
  assert.ok(Math.abs(fast.segments.find(s=>s.on).seconds-.002)<1e-9);
  const frames=[],errors=[];const d=new PhoneticDecoder({wpm:600,onFrame:f=>frames.push(f),onError:(message,observed)=>errors.push({message,observed})});
  for(let i=0;i<fast.pcm.length;i+=128)d.push(fast.pcm.subarray(i,i+128));
  assert.equal(frames.length,0);assert.ok(errors.length>0);assert.equal(typeof errors[0].observed.rawText,'string');
});
