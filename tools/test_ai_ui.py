#!/usr/bin/env python3
"""Real bundled DOM/JS; in-memory page to respect managed browser URL policy.
NativeBridge below is an explicit TEST DOUBLE. No actual AI inference or microphone is claimed.
"""
import json
import os
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';HTML=(ROOT/'dist/MorseTalk-AI-Portable.html').read_text();checks=[]
def passed(name): checks.append(name);print('PASS',name,flush=True)
with sync_playwright() as p:
    opts={'headless':True,'args':['--no-sandbox']}
    executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
    if executable: opts['executable_path']=executable
    browser=p.chromium.launch(**opts)
    context=browser.new_context(viewport={'width':1280,'height':1000},locale='ja-JP',accept_downloads=True)
    page=context.new_page();errors=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url));page.set_content(HTML)
    expect(page.locator('#listen')).to_be_enabled();expect(page.locator('#start')).to_be_disabled();expect(page.locator('#stop')).to_be_disabled();passed('Initial AI page idle; no automatic model, microphone or conversation start')
    page.locator('#test-ai').click();expect(page.locator('#status')).to_contain_text('許可');assert not requests;passed('AI consent is required before inference')
    page.locator('#self-test').click();expect(page.locator('#diagnostic')).to_contain_text('4速度すべてPCM復元一致',timeout=10000);passed('Real bundled codec + PCM decoder roundtrip at 120/300/600/1200 WPM')
    page.locator('#sample-text').fill('<img src=x onerror="window.pwned=1">');page.locator('#self-test').click();expect(page.locator('#transcript')).to_contain_text('onerror');assert page.locator('#transcript img').count()==0;assert not page.evaluate('window.pwned || false');passed('Decoded content is rendered as inert text, not executable HTML')
    page.locator('#sample-text').fill('はい');page.locator('#speed').select_option('1200')
    with page.expect_download() as dl: page.locator('#export-fast').click()
    wav=OUT/'v02-ui-export.wav';dl.value.save_as(wav);raw=wav.read_bytes();assert raw.startswith(b'RIFF');assert int.from_bytes(raw[24:28],'little')==48000;passed('Actual 48-kHz PCM16 fast Morse WAV download from UI')
    page.locator('#session').fill('00000000');page.locator('#self-test').click();expect(page.locator('#status')).to_contain_text('セッション');passed('Invalid session cannot enter send/diagnostics pipeline')
    page.locator('#session').fill('20260911');page.locator('#speed').select_option('600');page.locator('#clear').click();page.locator('#self-test').click()
    page.screenshot(path=str(OUT/'v02-desktop.png'),full_page=True);passed('Desktop screenshot captured')
    page.set_viewport_size({'width':393,'height':852});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(OUT/'v02-mobile.png'),full_page=True);passed('393-pixel Android layout has no horizontal overflow')
    page.set_viewport_size({'width':320,'height':750});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');passed('320-pixel compact layout has no horizontal overflow')
    page.locator('.pairing summary').click()
    before=page.evaluate("({role:document.querySelector('#role').value,provider:document.querySelector('#provider').value,consent:document.querySelector('#consent').checked,endpoint:document.querySelector('#endpoint').value})")
    page.locator('#pairing-code').fill('MT2|1234|AABBCCDD|300|4|96');page.locator('#apply-code').click()
    expect(page.locator('#session')).to_have_value('AABBCCDD');expect(page.locator('#speed')).to_have_value('300');expect(page.locator('#turns')).to_have_value('4');expect(page.locator('#max-bytes')).to_have_value('96')
    after=page.evaluate("({role:document.querySelector('#role').value,provider:document.querySelector('#provider').value,consent:document.querySelector('#consent').checked,endpoint:document.querySelector('#endpoint').value})")
    assert before==after;passed('Shared connection code applies all link limits without modifying private AI settings or consent')
    page.locator('#pairing-code').fill('MT2|9999|11223344|300|4|999');page.locator('#apply-code').click();expect(page.locator('#status')).to_contain_text('確認');expect(page.locator('#room')).to_have_value('1234');expect(page.locator('#session')).to_have_value('AABBCCDD');passed('Invalid shared limits cannot partially modify settings')
    page.locator('#new-session').click();expect(page.locator('#pairing-code')).to_have_value(__import__('re').compile(r'MT2\|1234\|[0-9A-F]{8}\|300\|4\|96'));assert page.locator('#session').input_value()!='00000000';passed('Explicit new-session action creates a nonzero random ID and matching code, without starting anything')
    page.locator('#preset').select_option('ideas');expect(page.locator('#topic')).to_have_value(__import__('re').compile('.*散歩.*'));expect(page.locator('#goal')).to_have_value(__import__('re').compile('.*相づち.*'));expect(page.locator('#stop')).to_be_disabled();passed('Conversation presets fill editable instructions without starting AI')
    page.set_viewport_size({'width':393,'height':852});page.evaluate('scrollTo(0,0)');page.screenshot(path=str(OUT/'polish-mobile.png'),full_page=True)
    page.set_viewport_size({'width':1280,'height':1000});page.screenshot(path=str(OUT/'polish-desktop.png'),full_page=True)
    passed('Polished preflight, connection settings and operation controls rendered in actual browser screenshots')
    # Explicit native/API test double. Never presents this as real-model validation in the report.
    native=context.new_page();native_errors=[];native.on('pageerror',lambda e:native_errors.append(str(e)))
    native.evaluate('''() => {
      window.aiCalls=[];window.savedFiles=[];window.slow=false;window.pendingAI=null;window.modelState={installed:false,loaded:false,busy:false,phase:'idle',description:'TEST DOUBLE · 未読込'};
      const reply=(id,ok,result,error)=>window.dispatchEvent(new CustomEvent('morsetalk-native-result',{detail:{id,ok,result,error}}));
      window.NativeBridge={request(raw){const d=JSON.parse(raw);
        if(d.method==='aiChat'){aiCalls.push(d.params);if(window.slow){window.pendingAI=d.id;return;}setTimeout(()=>reply(d.id,true,{text:'TEST DOUBLE 応答。'}),1);}
        else if(d.method==='aiCapabilities')reply(d.id,true,{native:true,provider:'ollama',endpoint:'http://127.0.0.1:11434/api/chat',model:'gemma4:e2b-it-qat'});
        else if(d.method==='localModelStatus')reply(d.id,true,{...window.modelState});
        else if(d.method==='saveFile'){savedFiles.push(d.params);reply(d.id,true,{});}
        else if(d.method==='loadModel'){if(window.slow){window.pendingAI=d.id;return;}reply(d.id,true,{loaded:true,description:'TEST DOUBLE · 読込済み'});}
        else if(d.method==='unloadModel'){if(window.slow){window.pendingAI=d.id;return;}reply(d.id,true,{loaded:false});}
        else if(d.method==='importModel'){
          window.dispatchEvent(new Event('morsetalk-native-pause'));window.pendingAI=d.id;
          setTimeout(()=>window.dispatchEvent(new Event('morsetalk-local-import-start')),20);
        }
        else if(d.method==='cancelAI'){if(window.pendingAI){const old=window.pendingAI;window.pendingAI=null;if(window.delayCancelError)setTimeout(()=>reply(old,false,null,'LATE CANCEL'),100);else reply(old,false,null,'TEST CANCEL');}reply(d.id,true,{});}
        else reply(d.id,true,{});
      }};
    }''')
    native.set_content(HTML);expect(native.locator('#endpoint')).to_be_enabled();passed('Android bridge exposes explicit endpoint/provider controls')
    native.locator('#provider').select_option('litert');expect(native.locator('#local-model-controls')).to_be_visible();expect(native.locator('#model')).to_have_value('gemma-4-E2B-it.litertlm');expect(native.locator('#model')).to_be_disabled();expect(native.locator('#endpoint')).to_be_disabled();passed('On-device Gemma locks model and endpoint; exposes import and CPU/GPU controls')
    native.locator('#load-model').click();expect(native.locator('#status')).to_contain_text('許可');assert native.evaluate('aiCalls.length')==0;passed('Local model loading requires explicit processing consent')
    native.locator('#consent').check();native.locator('#load-model').click();expect(native.locator('#status')).to_contain_text('モデル読み込み完了');passed('Local preload bridge contract (test double only)')
    native.locator('#import-model').click();expect(native.locator('#stop')).to_be_enabled();expect(native.locator('#import-model')).to_be_disabled();expect(native.locator('#provider')).to_be_disabled();native.locator('#stop').click();expect(native.locator('#listen')).to_be_enabled();expect(native.locator('#status')).to_contain_text('停止');passed('Model picker return enters cancellable copy state; stop restores controls without late-state overwrite')
    native.evaluate('window.slow=true');native.locator('#unload-model').click();expect(native.locator('#stop')).to_be_enabled();expect(native.locator('#provider')).to_be_disabled();native.locator('#stop').click();expect(native.locator('#listen')).to_be_enabled();expect(native.locator('#status')).to_contain_text('停止');native.evaluate('window.slow=false');passed('Pending native unload has a bounded cancellation contract and exclusive UI state')
    native.locator('#provider').select_option('ollama');expect(native.locator('#model')).to_have_value('gemma4:e2b-it-qat');expect(native.locator('#model')).to_be_enabled();expect(native.locator('#local-model-controls')).to_be_hidden();passed('Explicit HTTP-provider selection restores editable controls without silent fallback')
    native.locator('#model').fill('named-test-double');native.locator('#consent').check();native.locator('#test-ai').click();expect(native.locator('#transcript')).to_contain_text('TEST DOUBLE 応答。');passed('AI client → native bridge → result event contract, using a named test double')
    native.locator('#ai-pair').click();expect(native.locator('#status')).to_contain_text('PCM仮想経路テストが終了',timeout=15000)
    assert native.evaluate('aiCalls.length')==9 # one connection probe, eight bounded turns
    assert native.locator('#transcript').inner_text().count('数値処理で復号')==8;passed('Eight-turn integrated UI + stub AI + real PCM Morse virtual conversation')
    expect(native.locator('#turn-count')).to_have_text('8 / 8');expect(native.locator('#retry-count')).to_have_text('0');passed('Completed turn and retry counters reflect delivered PCM dialogue, not generated-only guesses')
    native.locator('summary').filter(has_text='検証ログを保存').click();native.locator('#export-log').click();expect(native.locator('#export-log')).to_be_enabled()
    native.wait_for_timeout(100)
    saved=native.evaluate("JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(savedFiles[0].base64),c=>c.charCodeAt(0))))")
    assert saved['containsConversation'] is False and saved['completedTurns']==8
    assert all('text' not in e and 'message' not in e for e in saved['events']);assert 'http://127.0.0.1:11434' not in json.dumps(saved);passed('Default exported log contains timings/counts but no dialogue text or endpoint configuration')
    native.locator('#include-transcript').check();native.locator('#export-log').click();native.wait_for_timeout(100)
    saved=native.evaluate("JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(savedFiles[1].base64),c=>c.charCodeAt(0))))")
    assert saved['containsConversation'] and any('TEST DOUBLE' in e.get('text','') for e in saved['events']);passed('Transcript appears in saved log only after explicit inclusion checkbox')
    native.evaluate('window.slow=true');native.locator('#ai-pair').click();expect(native.locator('#stop')).to_be_enabled();native.locator('#stop').click();expect(native.locator('#status')).to_contain_text('停止');expect(native.locator('#listen')).to_be_enabled();passed('Stop during pending AI generation cancels and restores controls')
    native.locator('#test-ai').click();expect(native.locator('#stop')).to_be_enabled();native.evaluate("window.dispatchEvent(new Event('morsetalk-native-pause'))");expect(native.locator('#status')).to_contain_text('画面を離れた');passed('Android pause contract stops AI/communication activity')
    native.evaluate('window.slow=false');native.locator('#provider').select_option('litert')
    native.evaluate("window.modelState={installed:true,loaded:false,busy:true,phase:'importing',copiedBytes:524288000,totalBytes:1048576000,freeBytes:8589934592,description:'TEST DOUBLE · モデル取り込み中'};dispatchEvent(new Event('morsetalk-local-model'))")
    expect(native.locator('#model-progress-wrap')).to_be_visible();expect(native.locator('#model-progress-text')).to_contain_text('50%');expect(native.locator('#model-space')).to_contain_text('8.0 GiB');expect(native.locator('#load-model')).to_be_disabled();passed('Native copy progress uses real byte fields and shows remaining-device storage (bridge test double)')
    native.locator('#quick-stop').click();native.wait_for_timeout(100);expect(native.locator('#load-model')).to_be_disabled();expect(native.locator('#provider')).to_be_disabled();passed('Cancellation does not enable competing work until native busy actually clears')
    native.evaluate("window.modelState.busy=false;window.modelState.phase='idle';dispatchEvent(new Event('morsetalk-local-model'))")
    expect(native.locator('#load-model')).to_be_enabled();expect(native.locator('#model-progress-wrap')).to_be_hidden();passed('UI recovers after the native worker reports completion')
    native.evaluate('window.slow=true;window.delayCancelError=true');native.locator('#load-model').click();expect(native.locator('#quick-stop')).to_be_enabled();native.locator('#quick-stop').click();native.evaluate('window.slow=false');native.locator('#test-ai').click();expect(native.locator('#status')).to_contain_text('AI APIから文章を受信');native.wait_for_timeout(250);expect(native.locator('#status')).to_contain_text('AI APIから文章を受信');passed('Late cancelled preload error cannot overwrite or cancel a newer successful AI operation')
    native.evaluate('window.slow=true;window.delayCancelError=false');native.locator('#test-ai').click();expect(native.locator('#quick-stop')).to_be_enabled()
    native.set_viewport_size({'width':320,'height':420});native.evaluate('scrollTo(0,document.body.scrollHeight)')
    assert native.evaluate("(()=>{const e=document.querySelector('#quick-stop'),r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e;})()")
    native.locator('#quick-stop').click();expect(native.locator('#test-ai')).to_be_enabled();passed('Sticky stop stays inside a compact keyboard-sized viewport and cancels the running request')
    assert not errors,errors;assert not native_errors,native_errors;assert not requests,requests;passed('No page exceptions or network requests during portable self-tests')
    browser.close()
(OUT/'v02-ui-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'real_llm_tested':False,'physical_audio_tested':False},ensure_ascii=False,indent=2))
print(f'{len(checks)} checks passed. Native AI is a test double, physical acoustic link untested.')
