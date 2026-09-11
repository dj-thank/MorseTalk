import test from 'node:test';
import assert from 'node:assert/strict';
import {INTERNATIONAL,WABUN,encodeText,decodeCode,normalizeText,codeToSegments,durationOf,pcmToWav,validateTiming} from '../app/core/morse.mjs';
import {base32Encode,base32Decode,crc32,packFrame,unpackFrame,prepareMessage,DuplicateWindow} from '../app/core/packet.mjs';
import {LinkSession} from '../app/core/link.mjs';
for(const [char,code] of Object.entries(INTERNATIONAL))test(`ITU ${char}`,()=>{assert.equal(encodeText(char).code,code);assert.equal(decodeCode(code).text,char);});
for(const [char,code] of Object.entries(WABUN))test(`和文 ${char}`,()=>{assert.equal(decodeCode(code,'wabun').text,char);});
test('SOS / PARIS vectors',()=>{assert.equal(encodeText('SOS').code,'... --- ...');assert.equal(encodeText('PARIS').code,'.--. .- .-. .. ...');});
test('English normalization is visible, unsupported text is not discarded',()=>{
 assert.equal(encodeText('Hello   World').normalized,'HELLO WORLD');assert.throws(()=>encodeText('こんにちは'));assert.throws(()=>encodeText('A🙂B'));assert.throws(()=>encodeText('Hi!'));
});
test('Wabun kana and voiced marks roundtrip',()=>{
 const r=encodeText('こんにちは がっこう パンダ ｺﾝﾋﾟｭｰﾀ','wabun');
 assert.equal(r.normalized,'コンニチハ ガツコウ パンダ コンピユータ');assert.equal(decodeCode(r.code,'wabun').text,r.normalized);
 assert.throws(()=>encodeText('東京','wabun'));assert.throws(()=>encodeText('ＡＢＣ','wabun'));
});
test('Wabun complete kana canonical roundtrip',()=>{for(const c of 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヰヱヲンガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポヴ'){assert.equal(decodeCode(encodeText(c,'wabun').code,'wabun').text,c);}});
test('Code parser rejects unrecognized glyphs and bounds',()=>{assert.throws(()=>decodeCode('.... <script>'));assert.throws(()=>decodeCode('.............'));assert.throws(()=>decodeCode('......'));assert.throws(()=>decodeCode('・・・ ／')); });
test('Token spacing normalizes safely',()=>{assert.equal(decodeCode('・・・  ---  ・・・').text,'SOS');assert.equal(decodeCode('... / ---').text,'S O');assert.equal(decodeCode('......','international',{strict:false}).text,'�');});
test('No unbounded code input',()=>{assert.throws(()=>encodeText('a'.repeat(4097)));assert.throws(()=>decodeCode('.'.repeat(32769)));});
test('ITU timing has 1/3/7 gaps, no accumulated spaces',()=>{
 const s=codeToSegments('.- - / .',20,{leadUnits:0,tailUnits:0});
 const units=s.slice(0,-1).map(x=>[x.on,Math.round(x.seconds/0.06)]);
 assert.deepEqual(units,[[true,1],[false,1],[true,3],[false,3],[true,3],[false,7],[true,1]]);
});
test('PARIS uses 50 units with a trailing word gap',()=>{
 const s=codeToSegments(encodeText('PARIS').code,20,{leadUnits:0,tailUnits:0});
 assert.ok(Math.abs((durationOf(s.slice(0,-1))/0.06)+7-50)<1e-9);
});
test('Timing constraints',()=>{for(const wpm of [0,7,61,NaN,Infinity])assert.throws(()=>validateTiming({wpm}));assert.throws(()=>validateTiming({frequency:300}));assert.throws(()=>validateTiming({volume:1}));});
test('WAV header and clipping',()=>{const a=pcmToWav(new Float32Array([-2,0,2]));const v=new DataView(a.buffer);assert.equal(a.length,50);assert.equal(v.getInt16(44,true),-32768);assert.equal(v.getInt16(48,true),32767);assert.equal(v.getUint32(24,true),16000);});
test('CRC32 standard check value',()=>assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926));
for(const [plain,b32] of [['f','MY'],['fo','MZXQ'],['foo','MZXW6'],['foob','MZXW6YQ'],['fooba','MZXW6YTB'],['foobar','MZXW6YTBOI']])test(`RFC4648 ${plain}`,()=>{assert.equal(base32Encode(new TextEncoder().encode(plain)),b32);assert.equal(new TextDecoder().decode(base32Decode(b32)),plain);});
test('Base32 rejects noncanonical trailing bits and invalid lengths',()=>{for(const s of ['MZ','M','AAA','AAAAAA','mzxw6','MZXW6=','MZX!'])assert.throws(()=>base32Decode(s));});
for(const text of ['こんにちは','声からモールスへ🙂','Hello, 世界!','がっこう\nパンダ','ภาษาไทย','العربية','한글','𝄞','<script>alert(1)</script>'])test(`UTF8 exact roundtrip ${text}`,()=>{const wire=packFrame({text,room:'1234',id:123,requestAck:true});const out=unpackFrame(wire,{expectedRoom:'1234'});assert.equal(out.text,text);assert.equal(out.id,123);assert.ok(out.requestAck);assert.equal(decodeCode(encodeText(wire).code).text,wire);});
test('Frame byte limit, empty text, ID and room validation',()=>{assert.doesNotThrow(()=>packFrame({text:'あ'.repeat(80),id:0}));assert.throws(()=>packFrame({text:'あ'.repeat(81),id:0}));for(const text of ['', '   '])assert.throws(()=>packFrame({text,id:0}));for(const room of ['123','abcd','00000'])assert.throws(()=>packFrame({text:'A',id:0,room}));for(const id of [-1,2**32,1.5])assert.throws(()=>packFrame({text:'A',id}));});
test('Room filtering is not acceptance',()=>{const wire=packFrame({text:'hello',room:'1000',id:0});assert.deepEqual(unpackFrame(wire,{expectedRoom:'1001'}),{ignored:true,reason:'other-room'});});
test('All one-bit frame corruptions are rejected',()=>{const wire=packFrame({text:'日本語🙂',room:'7777',id:876}), bytes=base32Decode(wire.split(' ')[2]);for(let i=0;i<bytes.length;i++)for(let b=0;b<8;b++){const broken=bytes.slice();broken[i]^=1<<b;assert.throws(()=>unpackFrame(`VVV MT1 ${base32Encode(broken)} KKK`));}});
test('Truncation and extension rejected',()=>{const wire=packFrame({text:'A',id:0});assert.throws(()=>unpackFrame(wire.slice(0,-1)));assert.throws(()=>unpackFrame(wire.replace(' KKK','A KKK')));assert.throws(()=>unpackFrame('SOS'));});
test('Duplicate window bounded and expires',()=>{let now=0;const d=new DuplicateWindow({capacity:2,ttlMs:50,clock:()=>now});const f=id=>({room:'0000',id,text:'a'});assert.equal(d.seen(f(1)),false);assert.equal(d.seen(f(1)),true);d.seen(f(2));d.seen(f(3));assert.equal(d.seen(f(1)),false);now=51;assert.equal(d.seen(f(1)),false);});
test('ACK requires exact room and ID, no duplicate speaking',()=>{const a=new LinkSession({room:'1234'}),b=new LinkSession({room:'1234'});const wire=a.begin({id:1,text:'元気？',requestAck:true});const r=b.receive(wire);assert.ok(r.ack);assert.equal(b.receive(wire).duplicate,true);assert.equal(a.receive(packFrame({type:'ack',room:'1234',id:2})).ignored,true);assert.ok(a.pending);assert.equal(a.receive(r.ack).acknowledged,true);assert.equal(a.pending,null);assert.equal(a.receive(r.ack).ignored,true);});
test('Timeout begins after playback, bounded retries, cancellation',()=>{let now=0;const a=new LinkSession({clock:()=>now});a.begin({id:2,text:'A',requestAck:true});now=100000;assert.equal(a.expired(),false);a.arm(1000);now+=1000;assert.ok(a.retry().retry);a.arm(100);now+=100;assert.ok(a.retry().failed);assert.equal(a.pending,null);a.begin({id:3,text:'B',requestAck:true});assert.throws(()=>a.begin({id:4,text:'C',requestAck:true}));a.cancel();assert.equal(a.pending,null);});
test('ACK cannot carry text or request another ACK',()=>{assert.throws(()=>packFrame({type:'ack',id:0,text:'A'}));assert.throws(()=>packFrame({type:'ack',id:0,requestAck:true}));});
test('Message preparation gives honest duration and bytes',()=>{const p=prepareMessage({text:'こんにちは',id:1,room:'0000',wpm:40});assert.equal(p.bytes,15);assert.ok(p.seconds>10);assert.equal(p.seconds,durationOf(p.segments));});
