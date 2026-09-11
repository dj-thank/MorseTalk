import test from 'node:test';
import assert from 'node:assert/strict';
import {utf8Encode,utf8Decode} from '../app/core/utf8.mjs';
for(const text of ['', 'ASCII\0', 'こんにちは', '🌏🎵', '\ufeffpayload', '\u007f\u0080\u07ff\u0800\uffff', '\u{10000}\u{10ffff}']) {
  test(`strict UTF-8 exact roundtrip ${JSON.stringify(text)}`,()=>{
    assert.deepEqual(utf8Encode(text),new TextEncoder().encode(text));
    assert.equal(utf8Decode(utf8Encode(text)),text);
  });
}
for(const bytes of [[0x80],[0xc0,0x80],[0xc1,0xbf],[0xc2],[0xc2,0x20],[0xe0,0x80,0x80],[0xe0,0xa0],[0xed,0xa0,0x80],[0xed,0xbf,0xbf],[0xf0,0x80,0x80,0x80],[0xf0,0x90,0x80],[0xf4,0x90,0x80,0x80],[0xf5,0x80,0x80,0x80],[0xff]])
  test(`strict UTF-8 rejects ${bytes.map(x=>x.toString(16)).join('-')}`,()=>assert.throws(()=>utf8Decode(Uint8Array.from(bytes))));
for(const text of ['\ud800','\udfff','a\ud800b','\ud800\ud800'])
  test(`reject malformed surrogate ${JSON.stringify(text)}`,()=>assert.throws(()=>utf8Encode(text)));
test('UTF-8 deterministic scalar sweep agrees with native encoder',()=>{
  for(let point=0;point<=0x10ffff;point+=137){
    if(point>=0xd800&&point<=0xdfff)continue;
    const text=String.fromCodePoint(point);
    assert.deepEqual(utf8Encode(text),new TextEncoder().encode(text));assert.equal(utf8Decode(utf8Encode(text)),text);
  }
});
