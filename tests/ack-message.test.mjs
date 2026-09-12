import test from 'node:test';import assert from 'node:assert/strict';
import {ackText} from '../monitor/ack-message.mjs';
import {packPhonetic,unpackPhonetic,phoneticPcm,PhoneticDecoder,kanaToWire} from '../app/core/phonetic-morse.mjs';
test('ACK Japanese text describes its actual sender and acknowledged message',()=>{
 assert.equal(ackText(1,3),'端末Bがメッセージ3の受信を確認しました（本文なしACK）。');
 assert.equal(ackText(0,4),'端末Aがメッセージ4の受信を確認しました（本文なしACK）。');
 assert.equal(ackText(2,1),'');
});
test('Legacy empty ACK remains decodable',()=>{
 const wire=packPhonetic({sender:1,seq:1,type:'ack'}),frames=[],headers=[];
 const decoded=unpackPhonetic(wire);assert.equal(decoded.text,'');assert.equal(decoded.wire,'');
 const d=new PhoneticDecoder({wpm:40,onHeader:h=>headers.push(h),onFrame:f=>frames.push(f)});d.push(phoneticPcm(wire,{wpm:40}).pcm);
 assert.equal(frames.length,1);assert.ok(headers.some(h=>h.type==='ack'&&h.sender===1&&h.seq===1));
});
test('Japanese ACK text is decoded from actual PCM one received unit at a time',()=>{
 const payload=kanaToWire('じゅしんしました'),frames=[],characters=[];
 const wire=packPhonetic({sender:1,seq:1,type:'ack',wire:payload.wire});
 const receiver=new PhoneticDecoder({wpm:40,onCharacter:e=>characters.push(e),onFrame:f=>frames.push(f)});
 const {pcm}=phoneticPcm(wire,{wpm:40});for(let i=0;i<pcm.length;i+=128)receiver.push(pcm.subarray(i,i+128));
 assert.equal(frames[0].type,'ack');assert.equal(frames[0].text,'じゅしんしました');
 assert.ok(characters.some(e=>e.type==='ack'&&e.wire==='J'));
 assert.ok(characters.some(e=>e.type==='ack'&&e.wire==='JU'&&e.text==='じゅ'));
 assert.throws(()=>unpackPhonetic(wire.replace('JU','JA')),/CRC/);
});
