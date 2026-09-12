import test from 'node:test';
import assert from 'node:assert/strict';
import {PhoneticDecoder,phoneticPcm,packPhonetic} from '../app/core/phonetic-morse.mjs';
test('all received characters include header, ACK body and checksum before frame completion',()=>{
  const wire=packPhonetic({sender:1,seq:1,type:'ack',wire:'JU SHI N SHI MA SHI TA'});
  const observations=[],frames=[];
  const decoder=new PhoneticDecoder({wpm:40,onSymbols:e=>observations.push(e.text),onFrame:f=>frames.push(f)});
  const {pcm}=phoneticPcm(wire,{wpm:40});
  decoder.push(pcm);
  assert(observations.includes('B'));
  assert(observations.some(s=>s.startsWith('B1+ JU')));
  assert(observations.some(s=>s.trim()===wire));
  assert.equal(frames[0].text,'じゅしんしました');
});
