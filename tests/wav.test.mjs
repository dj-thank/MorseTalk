import test from 'node:test';
import assert from 'node:assert/strict';
import {pcmToWav,encodeText,decodeCode,codeToSegments,synthesize} from '../app/core/morse.mjs';
import {packFrame,unpackFrame} from '../app/core/packet.mjs';
import {parseWav} from '../app/core/wav.mjs';
import {ToneDetector} from '../app/core/dsp.mjs';
function fixture(){return new Uint8Array(pcmToWav(Float32Array.from([0,.5,-.5,.99,-.99]),16000));}
test('PCM16 WAV import preserves sample rate and bounded quantization',()=>{
 const r=parseWav(fixture());assert.equal(r.sampleRate,16000);assert.equal(r.pcm.length,5);assert.ok(Math.abs(r.pcm[1]-.5)<1e-4);
});
for(const [offset,type,value,label] of [[0,'u8',0,'RIFF'],[4,'u32',999,'RIFF length'],[16,'u32',999,'chunk size'],[20,'u16',85,'compressed format'],[22,'u16',3,'channel count'],[24,'u32',7999,'sample rate'],[28,'u32',123,'byte rate'],[32,'u16',1,'block align'],[34,'u16',4,'bit depth'],[40,'u32',1,'data length']]){
 test(`WAV rejects malformed ${label}`,()=>{const b=fixture(),v=new DataView(b.buffer);if(type==='u8')v.setUint8(offset,value);else if(type==='u16')v.setUint16(offset,value,true);else v.setUint32(offset,value,true);assert.throws(()=>parseWav(b));});
}
test('WAV rejects overlong audio before allocating output',()=>assert.throws(()=>parseWav(fixture(),{maxSeconds:.0001})));
test('WAV rejects garbage trailing partial chunk',()=>{const b=new Uint8Array(fixture().length+2);b.set(fixture());new DataView(b.buffer).setUint32(4,b.length-8,true);assert.throws(()=>parseWav(b));});
test('WAV float32 refuses NaN/infinity',()=>{
 const b=new Uint8Array(48);b.set(fixture().subarray(0,44));const v=new DataView(b.buffer);v.setUint32(4,40,true);v.setUint16(20,3,true);v.setUint32(28,64000,true);v.setUint16(32,4,true);v.setUint16(34,32,true);v.setUint32(40,4,true);v.setFloat32(44,NaN,true);assert.throws(()=>parseWav(b));v.setFloat32(44,.25,true);assert.equal(parseWav(b).pcm[0],.25);
});
test('Unicode lone surrogate is rejected, never silently replaced',()=>{for(const s of ['\ud800','\udfff','a\ud800x','\udfff\ud800'])assert.throws(()=>packFrame({text:s,id:1}));});
test('Exported WAV to imported WAV through DSP and CRC preserves Japanese',()=>{
 const wire=packFrame({text:'明日、会おう🙂',id:731,room:'1212'}),pcm=synthesize(codeToSegments(encodeText(wire).code,40));
 const wav=parseWav(pcmToWav(pcm)),results=[];new ToneDetector({sampleRate:wav.sampleRate,wpm:40,onMessage:x=>results.push(x)}).push(wav.pcm);
 assert.equal(results.length,1);assert.equal(unpackFrame(results[0].text,{expectedRoom:'1212'}).text,'明日、会おう🙂');
});
test('Fixed kana mode rejects unsupported continuous prosigns, not fabricated text',()=>assert.throws(()=>decodeCode('-..---','wabun')));
