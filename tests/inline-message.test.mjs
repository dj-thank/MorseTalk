import test from 'node:test';import assert from 'node:assert/strict';
import { messageCells } from '../monitor/inline-message.mjs';
import { packPhonetic,phoneticPcm,PhoneticDecoder } from '../app/core/phonetic-morse.mjs';

test('Actual Morse N then A updates the same message cell before it becomes な',()=>{
  const states=[];
  const d=new PhoneticDecoder({wpm:60,onCharacter:e=>{const cells=messageCells(e.wire);if(cells.length===1)states.push(cells[0]);}});
  const {pcm}=phoneticPcm(packPhonetic({sender:0,seq:1,wire:'NA'}),{wpm:60});
  for(let i=0;i<pcm.length;i+=128)d.push(pcm.subarray(i,i+128));
  assert.ok(states.some(s=>s.roman==='N'&&!s.ready));
  assert.ok(states.some(s=>s.roman==='NA'&&s.ready&&s.text==='な'));
});
test('Previously received syllables remain in the sentence while its last cell types',()=>{
  const partial=messageCells('KO N NI CHI W');assert.equal(partial.slice(0,-1).map(c=>c.text).join(''),'こんにち');
  assert.equal(partial.at(-1).roman,'W');assert.equal(partial.at(-1).ready,false);
  assert.equal(messageCells('KO N NI CHI WA').map(c=>c.text).join(''),'こんにちわ'); // WA is わ; don't silently rewrite it to は.
});
test('A completed N becomes ん at its own boundary, without lagging one syllable',()=>{
  const open=messageCells('KA N');assert.equal(open.at(-1).roman,'N');assert.equal(open.at(-1).ready,false);
  const closed=messageCells('KA N ');assert.equal(closed.at(-1).roman,'N');assert.equal(closed.at(-1).ready,true);assert.equal(closed.map(c=>c.text).join(''),'かん');
  const events=[],d=new PhoneticDecoder({wpm:60,onCharacter:e=>events.push(e)});
  const {pcm}=phoneticPcm(packPhonetic({sender:0,seq:1,wire:'KA N NA'}));for(let i=0;i<pcm.length;i+=128)d.push(pcm.subarray(i,i+128));
  const atGap=events.find(e=>e.wire==='KA N'&&e.boundary);assert.ok(atGap);assert.equal(messageCells(atGap.wire,{boundary:atGap.boundary}).at(-1).ready,true);
});
test('English cells remain received letters, without a fabricated kana conversion',()=>{
  const cells=messageCells('HELLO',{language:'en'});assert.equal(cells.map(c=>c.text).join(''),'HELLO');assert.ok(cells.every(c=>!c.convert));
});
