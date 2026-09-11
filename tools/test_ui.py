#!/usr/bin/env python3
"""Browser integration tests. Uses Chromium fake microphone, never physical audio.
Install developer dependency: pip install playwright; playwright install chromium.
CHROMIUM_PATH may point to an installed Chromium binary.
"""
import json
import os
from pathlib import Path
import shutil
import sys
import threading
import time
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import LocalServer
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
checks=[]
def passed(name):checks.append(name);print('PASS',name,flush=True)
server=LocalServer(0);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
try:
 with sync_playwright() as p:
  executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
  opts={'headless':True,'args':['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',f'--use-file-for-fake-audio-capture={ROOT / "examples/japanese-hai.wav"}']}
  if executable:opts['executable_path']=executable
  browser=p.chromium.launch(**opts)
  context=browser.new_context(viewport={'width':1280,'height':1100},locale='ja-JP')
  page=context.new_page();errors=[];external=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:')) and not r.url.startswith(server.origin+'/') else None)
  page.goto(server.origin+'/');expect(page.locator('#send')).to_be_disabled();expect(page.locator('#voice')).to_be_disabled();passed('Boot: no model, voice input disabled; text mode remains available')
  page.locator('#draft').fill('こんにちは');expect(page.locator('#send')).to_be_enabled();expect(page.locator('#estimate')).to_contain_text('秒');passed('Japanese packet preview and duration')
  page.locator('#draft').fill('あ'*81);expect(page.locator('#send')).to_be_disabled();passed('UTF-8 limit blocks oversized Japanese')
  page.locator('#mode').select_option('wabun');page.locator('#draft').fill('漢字');expect(page.locator('#send')).to_be_disabled();passed('Wabun rejects kanji without silent loss')
  page.locator('#draft').fill('ありがとう');expect(page.locator('#normalized')).to_contain_text('アリガトウ');passed('Wabun normalization is explicit')
  page.locator('#mode').select_option('packet');page.locator('#draft').fill('こんにちは')
  page.locator('.advanced summary').click();page.locator('#auto-speak').uncheck();page.locator('.advanced summary').click()
  page.locator('.code-preview summary').click()
  with page.expect_download() as dl:page.locator('#export-wav').click()
  wav=OUT/'browser-export.wav';dl.value.save_as(wav)
  assert wav.read_bytes().startswith(b'RIFF');passed('Browser WAV download is a real RIFF file')
  page.locator('#import-audio').set_input_files(str(wav));expect(page.locator('#history')).to_contain_text('こんにちは',timeout=10000);expect(page.locator('#history')).to_contain_text('CRC検証済み');passed('Browser WAV export → import → DSP → CRC → Japanese conversation')
  before=page.locator('#history .bubble').count();page.locator('#import-audio').set_input_files(str(wav));expect(page.locator('#status')).to_contain_text('解析を終了');assert page.locator('#history .bubble').count()==before;passed('Duplicate frame suppression')
  page.locator('#room').fill('1111');page.locator('#room').dispatch_event('change');page.locator('#import-audio').set_input_files(str(ROOT/'examples/japanese-hai.wav'));expect(page.locator('#status')).to_contain_text('解析を終了');assert page.locator('#history .bubble').count()==before;passed('Room filtering ignores other code')
  page.locator('#room').fill('0000');page.locator('#room').dispatch_event('change')
  page.locator('#draft').fill('<img src=x onerror="window.pwned=1">')
  with page.expect_download() as dl:page.locator('#export-wav').click()
  xss=OUT/'xss.wav';dl.value.save_as(xss);page.locator('#import-audio').set_input_files(str(xss));expect(page.locator('#history')).to_contain_text('onerror');assert page.locator('#history img').count()==0;assert not page.evaluate('window.pwned || false');passed('Untrusted received text is rendered as text, not HTML')
  page.locator('[data-tab="manual"]').click();page.locator('#manual-code').fill('... --- ...');expect(page.locator('#manual-text')).to_have_text('SOS');passed('Manual Morse text decoder')
  page.locator('#manual-code').fill('----');expect(page.locator('#manual-text')).to_contain_text('不明');passed('Invalid manual symbol is not guessed')
  page.locator('[data-tab="guide"]').click();page.locator('#self-test').click();expect(page.locator('#self-test-result')).to_contain_text('成功');passed('In-app self-test runs actual synthesized PCM')
  page.locator('[data-tab="conversation"]').click();page.reload();assert page.locator('#history .bubble').count()==0;passed('History is ephemeral by default')
  page.locator('.advanced summary').click();page.locator('#save-history').check();page.locator('#auto-speak').uncheck();page.locator('.advanced summary').click()
  page.locator('#import-audio').set_input_files(str(ROOT/'examples/japanese-hai.wav'));expect(page.locator('#history')).to_contain_text('はい');page.reload();expect(page.locator('#history')).to_contain_text('はい');passed('Explicit local-history opt-in survives reload')
  page.on('dialog',lambda dialog:dialog.accept());page.locator('#clear-history').click();assert page.locator('#history .bubble').count()==0;passed('History clear removes persisted messages')
  page.locator('#draft').fill('こんにちは');page.locator('#send').click();expect(page.locator('#status')).to_contain_text('送信中');page.locator('#stop').click();expect(page.locator('#status')).to_contain_text('停止');expect(page.locator('#history')).to_contain_text('中断');passed('User stop interrupts active audio transmission')
  page.locator('#send').click();page.evaluate("window.dispatchEvent(new Event('morsetalk-native-pause'))");expect(page.locator('#status')).to_contain_text('非表示');passed('Native lifecycle event stops the active transmission')
  # Real browser AudioWorklet, fake capture WAV supplied to Chromium's media device.
  page.locator('#listen').click();expect(page.locator('#status')).to_contain_text('受信中',timeout=8000)
  expect(page.locator('#history')).to_contain_text('はい',timeout=35000);passed('Live AudioWorklet decodes Japanese from Chromium fake microphone')
  page.locator('#stop').click();expect(page.locator('#status')).to_contain_text('停止');passed('Receiver releases fake microphone on stop')
  # Regression: an audio play call awaiting permission/context must not start after stop.
  cancelled=page.evaluate("""async()=>{const {AudioEngine}=await import('/js/audio.mjs');const a=new AudioEngine();let resolve; a.contextReady=()=>new Promise(r=>resolve=r);const play=a.play([{on:true,seconds:.1}]);await new Promise(r=>setTimeout(r,20));a.stopPlayback();resolve({});return await play;}""")
  assert cancelled is False;passed('Asynchronous pre-play cancellation regression')
  # Denied permission through a controlled browser API rejection.
  page.evaluate("() => { navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('denied','NotAllowedError')); }")
  page.locator('#listen').click();expect(page.locator('#notice')).to_contain_text('マイクが許可されていません');expect(page.locator('#listen')).to_be_enabled();passed('Denied microphone permission has a recoverable UI state')
  assert not errors,errors;assert not external,external;passed('No page errors and no external network requests')
  # Source UI screenshots from real rendering, not a mockup.
  clean=context.new_page();clean.goto(server.origin+'/');clean.locator('#draft').fill('こんにちは。聞こえますか？');clean.screenshot(path=str(OUT/'desktop.png'),full_page=True)
  for width in (360,390,768,1280):
    clean.set_viewport_size({'width':width,'height':844});clean.wait_for_timeout(50)
    assert clean.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Horizontal overflow at {width}'
    if width==390:clean.screenshot(path=str(OUT/'android-width.png'),full_page=True)
  passed('Responsive layouts have no horizontal overflow at 360/390/768/1280 pixels')
  # Standalone offline file (no server required for Morse core).
  portable=context.new_page();portable.goto((ROOT/'dist/MorseTalk-Portable.html').as_uri());portable.locator('#draft').fill('こんにちは');expect(portable.locator('#send')).to_be_enabled();portable.locator('[data-tab="guide"]').click();portable.locator('#self-test').click();expect(portable.locator('#self-test-result')).to_contain_text('成功');passed('Standalone HTML bundles correctly and self-test runs from file://')
  # ASR UI transport mock: explicitly NOT a recognition-quality test.
  mock=context.new_page();mock.route('**/api/capabilities',lambda route:route.fulfill(json={'platform':'windows','offlineSpeech':True,'description':'TEST DOUBLE'}))
  bodies=[]
  def fake_asr(route):bodies.append(route.request.post_data_buffer);route.fulfill(json={'text':'認識結果のテスト','offline':True})
  mock.route('**/api/transcribe*',fake_asr);mock.goto(server.origin+'/');expect(mock.locator('#voice')).to_be_enabled();mock.locator('#voice').click();expect(mock.locator('#status')).to_contain_text('話してください');mock.wait_for_timeout(500);mock.locator('#voice').click();expect(mock.locator('#draft')).to_have_value('認識結果のテスト',timeout=8000);assert bodies and bodies[0].startswith(b'RIFF');assert mock.locator('#history .bubble').count()==0;passed('Recording → bounded WAV → mock ASR → editable text; does not auto-send')
  browser.close()
finally:
 server.shutdown();server.server_close();thread.join()
 (OUT/'browser-results.json').write_text(json.dumps({'tests':len(checks),'passed':checks,'note':'Linux Chromium; fake microphone + ASR test doubles where explicitly named. No real Android/Windows hardware tested.'},ensure_ascii=False,indent=2),encoding='utf8')
print(f'{len(checks)} browser integration checks passed.')
