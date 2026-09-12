import test from 'node:test';import assert from 'node:assert/strict';
import { discussionPrompt,parseDiscussion,parseDisplay } from '../app/core/discussion.mjs';
const response=fields=>JSON.stringify({reply:'不確かな時は、確認を優先します。',reading:'ふたしかなときは、かくにんをゆうせんします。',understanding:'不確実な時の行動が論点。',focus:'確認が必要な条件を絞る',...fields});
test('Discussion starts with a claim and gives the peer a distinct critical role',()=>{
  const a=discussionPrompt({role:0,topic:'AIの判断'}),b=discussionPrompt({role:1,topic:'AIの判断',last:true});
  assert.notEqual(a,b);assert.match(a,/理由/);assert.match(b,/反例/);assert.match(b,/条件付きの結論/);
});
test('A substantive kanji reply retains the exact kana to be transmitted',()=>{
  const result=parseDiscussion(response());assert.equal(result.reply,'不確かな時は、確認を優先します。');assert.equal(result.phonetic.text,result.reading);
});
test('A slightly longer reading does not terminate a continuous conversation',()=>{
  const result=parseDiscussion(response({reply:'資源の再利用を検討し、必要な設備を慎重に選びます。',reading:'かぎられたしげんをさいりようするぐたいてきなほうほうをけんとうし、ひつようなせつびをひとつずつしんちょうにえらびます。'}));
  assert.ok(result.phonetic.text.length>54);assert.equal(result.phonetic.text,result.reading);
});
test('Generic conversation-management responses do not pass as discussion',()=>{
  assert.throws(()=>parseDiscussion(response({reply:'どんなことについて話したいですか',reading:'どんなことについてはなしたいですか'})),/具体的/);
  assert.throws(()=>parseDiscussion(response({focus:'応答'})),/具体的/);
});
test('Kanji formatting is accepted only with a reading that matches the received message',()=>{
  assert.equal(parseDisplay(JSON.stringify({display:'名前を教えて。',reading:'なまえをおしえて。'}),'なまえをおしえて'),'名前を教えて。');
  assert.throws(()=>parseDisplay(JSON.stringify({display:'住所を教えて。',reading:'じゅうしょをおしえて。'}),'なまえをおしえて'),/一致/);
});
test('English punctuation is normalized before computing the on-air CRC',()=>{
  const result=parseDiscussion(response({reply:'I’d verify uncertain facts before acting.',reading:'I would verify uncertain facts before acting.',understanding:'Uncertainty needs checking.',focus:'Check before action'}),'en');
  assert.equal(result.phonetic.wire,"I'D VERIFY UNCERTAIN FACTS BEFORE ACTING.");
});
