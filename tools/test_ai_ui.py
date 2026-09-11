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
    # Explicit native/API test double. Never presents this as real-model validation in the report.
    native=context.new_page();native_errors=[];native.on('pageerror',lambda e:native_errors.append(str(e)))
    native.evaluate('''() => {
      window.aiCalls=[];window.slow=false;window.pendingAI=null;
      const reply=(id,ok,result,error)=>window.dispatchEvent(new CustomEvent('morsetalk-native-result',{detail:{id,ok,result,error}}));
      window.NativeBridge={request(raw){const d=JSON.parse(raw);
        if(d.method==='aiChat'){aiCalls.push(d.params);if(window.slow){window.pendingAI=d.id;return;}setTimeout(()=>reply(d.id,true,{text:'TEST DOUBLE 応答。'}),1);}
        else if(d.method==='cancelAI'){if(window.pendingAI){reply(window.pendingAI,false,null,'TEST CANCEL');window.pendingAI=null;}reply(d.id,true,{});}
        else reply(d.id,true,{});
      }};
    }''')
    native.set_content(HTML);expect(native.locator('#endpoint')).to_be_enabled();passed('Android bridge exposes explicit endpoint/provider controls')
    native.locator('#model').fill('named-test-double');native.locator('#consent').check();native.locator('#test-ai').click();expect(native.locator('#transcript')).to_contain_text('TEST DOUBLE 応答。');passed('AI client → native bridge → result event contract, using a named test double')
    native.locator('#ai-pair').click();expect(native.locator('#status')).to_contain_text('PCM仮想経路テストが終了',timeout=15000)
    assert native.evaluate('aiCalls.length')==9 # one connection probe, eight bounded turns
    assert native.locator('#transcript').inner_text().count('数値処理で復号')==8;passed('Eight-turn integrated UI + stub AI + real PCM Morse virtual conversation')
    native.evaluate('window.slow=true');native.locator('#ai-pair').click();expect(native.locator('#stop')).to_be_enabled();native.locator('#stop').click();expect(native.locator('#status')).to_contain_text('停止');expect(native.locator('#listen')).to_be_enabled();passed('Stop during pending AI generation cancels and restores controls')
    native.locator('#test-ai').click();expect(native.locator('#stop')).to_be_enabled();native.evaluate("window.dispatchEvent(new Event('morsetalk-native-pause'))");expect(native.locator('#status')).to_contain_text('画面を離れた');passed('Android pause contract stops AI/communication activity')
    assert not errors,errors;assert not native_errors,native_errors;assert not requests,requests;passed('No page exceptions or network requests during portable self-tests')
    browser.close()
(OUT/'v02-ui-results.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'real_llm_tested':False,'physical_audio_tested':False},ensure_ascii=False,indent=2))
print(f'{len(checks)} checks passed. Native AI is a test double, physical acoustic link untested.')
