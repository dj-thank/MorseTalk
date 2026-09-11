#!/usr/bin/env python3
"""Real DOM/JS UI tests loaded into about:blank without changing managed policies.
No network, microphone capture, OS speech recognition or installed Android app.
NativeBridge is a named test double only in the last two contract tests.
"""
import json
import os
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
HTML=(ROOT/'dist/MorseTalk-Portable.html').read_text(encoding='utf8')
checks=[]
def passed(name):checks.append(name);print('PASS',name,flush=True)
with sync_playwright() as p:
 executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
 opts={'headless':True,'args':['--no-sandbox']}
 if executable:opts['executable_path']=executable
 browser=p.chromium.launch(**opts)
 ctx=browser.new_context(viewport={'width':1280,'height':1100},locale='ja-JP',accept_downloads=True)
 page=ctx.new_page();errors=[];requests=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(HTML)
 expect(page.locator('#voice')).to_be_disabled();expect(page.locator('#send')).to_be_disabled();passed('No native ASR: voice disabled; initial empty draft cannot send')
 page.locator('#draft').fill('こんにちは');expect(page.locator('#send')).to_be_enabled();expect(page.locator('#estimate')).to_contain_text('秒');passed('Japanese packet text preview and honest duration')
 page.locator('#draft').fill('あ'*81);expect(page.locator('#send')).to_be_disabled();passed('240-byte payload limit disables oversized sends')
 page.locator('#mode').select_option('wabun');page.locator('#draft').fill('漢字');expect(page.locator('#send')).to_be_disabled();passed('Kanji is rejected in kana-only Wabun mode')
 page.locator('#draft').fill('ありがとう');expect(page.locator('#normalized')).to_contain_text('アリガトウ');passed('Wabun normalization shown before send')
 page.locator('#mode').select_option('international');page.locator('#draft').fill('Hello');expect(page.locator('#normalized')).to_contain_text('HELLO');passed('International mode normalizes Latin case')
 page.locator('#mode').select_option('packet');page.locator('#draft').fill('こんにちは')
 page.locator('.advanced summary').click();page.locator('#auto-speak').uncheck();page.locator('.advanced summary').click()
 page.locator('.code-preview summary').click()
 with page.expect_download() as dl:page.locator('#export-wav').click()
 wav=OUT/'browser-export.wav';dl.value.save_as(wav);assert wav.read_bytes().startswith(b'RIFF');passed('UI exports actual synthesized PCM16 WAV')
 page.locator('#import-audio').set_input_files(str(wav));expect(page.locator('#history')).to_contain_text('こんにちは',timeout=10000);expect(page.locator('#history')).to_contain_text('CRC検証済み');passed('UI WAV round trip through DSP and CRC recovers Japanese')
 before=page.locator('#history .bubble').count();page.locator('#import-audio').set_input_files(str(wav));expect(page.locator('#status')).to_contain_text('解析を終了');assert page.locator('#history .bubble').count()==before;passed('Same-frame duplicate does not create duplicate conversation')
 page.locator('#room').fill('1111');page.locator('#room').dispatch_event('change');page.locator('#import-audio').set_input_files(str(ROOT/'examples/japanese-hai.wav'));expect(page.locator('#status')).to_contain_text('解析を終了');assert page.locator('#history .bubble').count()==before;passed('Other-room frame is ignored')
 page.locator('#room').fill('0000');page.locator('#room').dispatch_event('change')
 page.locator('#draft').fill('<img src=x onerror="window.pwned=1">')
 with page.expect_download() as dl:page.locator('#export-wav').click()
 xss=OUT/'xss.wav';dl.value.save_as(xss);page.locator('#import-audio').set_input_files(str(xss));expect(page.locator('#history')).to_contain_text('onerror');assert page.locator('#history img').count()==0;assert not page.evaluate('window.pwned || false');passed('Received markup is harmless text, never executed')
 page.locator('[data-tab="manual"]').click();page.locator('#manual-code').fill('... --- ...');expect(page.locator('#manual-text')).to_have_text('SOS');passed('Manual Morse decodes SOS')
 page.locator('#manual-code').fill('----');expect(page.locator('#manual-text')).to_contain_text('不明');passed('Invalid manual code is not guessed')
 page.locator('#manual-code').fill('');page.locator('#dot').click();page.locator('#dash').click();expect(page.locator('#manual-text')).to_have_text('A');page.locator('#manual-backspace').click();expect(page.locator('#manual-text')).to_have_text('E');passed('Dot/dash buttons and backspace update decoding')
 page.locator('[data-tab="guide"]').click();page.locator('#self-test').click();expect(page.locator('#self-test-result')).to_contain_text('成功');passed('In-app PCM self-test executes from single HTML')
 page.locator('[data-tab="conversation"]').click();page.locator('#draft').fill('こんにちは');page.locator('#send').click();expect(page.locator('#status')).to_contain_text('送信中');page.locator('#stop').click();expect(page.locator('#status')).to_contain_text('停止');expect(page.locator('#history')).to_contain_text('中断');passed('UI stop cancels active or pending transmission')
 page.locator('#send').click();page.evaluate("window.dispatchEvent(new Event('morsetalk-native-pause'))");expect(page.locator('#status')).to_contain_text('非表示');passed('Native pause contract triggers transmission shutdown')
 page.on('dialog',lambda dialog:dialog.accept());page.locator('#clear-history').click();assert page.locator('#history .bubble').count()==0;passed('Conversation clear removes all displayed messages')
 page.locator('#wpm').fill('0');page.locator('#wpm').dispatch_event('change');expect(page.locator('#send')).to_be_disabled();page.locator('#listen').click();expect(page.locator('#notice')).to_contain_text('8〜60');expect(page.locator('#listen')).to_be_enabled();passed('Invalid speed is recoverable, including attempted RX')
 assert not errors,errors;assert not requests,requests;passed('Actual UI tests produced no JS page errors or network requests')
 clean=ctx.new_page();clean.set_content(HTML);clean.locator('#draft').fill('こんにちは。聞こえますか？');clean.screenshot(path=str(OUT/'desktop.png'),full_page=True)
 for width in (360,390,768,1280):
  clean.set_viewport_size({'width':width,'height':844});clean.wait_for_timeout(40);assert clean.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Horizontal overflow: {width}'
  if width==390:clean.screenshot(path=str(OUT/'android-width.png'),full_page=True)
 passed('Responsive rendering: no overflow at 360/390/768/1280 px')
 # Contract only: exercise asynchronous native response and error in actual frontend.
 native=ctx.new_page();native.evaluate("""()=>{window.NativeBridge={request(raw){const c=JSON.parse(raw);setTimeout(()=>{window.dispatchEvent(new CustomEvent('morsetalk-native-result',{detail:{id:c.id,ok:true,result:c.method==='capabilities'?{platform:'android',offlineSpeech:true,description:'TEST DOUBLE'}:c.method==='recognize'?{text:'認識結果のテスト'}:{}}}));},10)}}}""")
 native.set_content(HTML);expect(native.locator('#voice')).to_be_enabled();native.locator('#voice').click();expect(native.locator('#draft')).to_have_value('認識結果のテスト');assert native.locator('#history .bubble').count()==0;passed('Native ASR test-double contract places editable draft, never auto-sends')
 native.evaluate("""()=>{window.NativeBridge.request=raw=>{const c=JSON.parse(raw);setTimeout(()=>window.dispatchEvent(new CustomEvent('morsetalk-native-result',{detail:{id:c.id,ok:c.method!=='recognize',result:{},error:'テスト用マイク拒否'}})),10)}}""")
 native.locator('#voice').click();expect(native.locator('#notice')).to_contain_text('テスト用マイク拒否');expect(native.locator('#voice')).to_be_enabled();passed('Native ASR test-double error restores idle controls')
 browser.close()
(OUT/'browser-inmemory-results.json').write_text(json.dumps({'tests':len(checks),'passed':checks,'environment':'Linux Chromium; owned standalone HTML rendered in memory. Native recognition tests use explicit test doubles. No microphone capture, real TTS, Android build, or Windows runtime tested.'},ensure_ascii=False,indent=2),encoding='utf8')
print(f'{len(checks)} in-memory browser checks passed.')
