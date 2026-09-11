#!/usr/bin/env python3
"""Offline rendered QR -> PNG import -> confirmation, plus virtual-camera lifecycle.
No physical camera, network relay, real LLM or OS file picker is exercised here.
"""
import json, re, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
checks=[]
def passed(s):checks.append(s);print('PASS',s,flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or None,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
    page.set_content((ROOT/'dist/MorseTalk-AI-Portable.html').read_text())
    page.locator('#show-acoustic-qr').click();expect(page.locator('#qr-output')).to_be_visible()
    code=page.evaluate("()=>{const c=document.querySelector('#pair-qr'),d=c.getContext('2d').getImageData(0,0,c.width,c.height);return jsQR(d.data,d.width,d.height).data;}")
    assert code.startswith('MT2|');passed('Actual bundled encoder and decoder reproduce the acoustic pairing code')
    with page.expect_download() as saved:page.locator('#qr-save').click()
    png=OUT/'acoustic-pairing.png';saved.value.save_as(png);assert png.read_bytes().startswith(b'\x89PNG');passed('QR export is a real PNG with a readable quiet zone')
    page.locator('#session').fill('AAAAAAAA');page.locator('#qr-image').set_input_files(str(png));expect(page.locator('#qr-apply')).to_be_enabled()
    expect(page.locator('#session')).to_have_value('AAAAAAAA');expect(page.locator('#qr-preview')).to_contain_text('音響');passed('Importing a QR image only previews; settings are unchanged before confirmation')
    page.locator('#qr-apply').click();expect(page.locator('#session')).to_have_value(code.split('|')[2]);expect(page.locator('#stop')).to_be_disabled();passed('Confirmation applies only pairing settings and does not start capture or AI')
    page.locator('.qr-import summary').click();page.locator('#qr-input').fill('https://evil.example/?key=no');page.locator('#qr-stage').click();expect(page.locator('#qr-apply')).to_be_disabled();passed('Unrelated URL QR is rejected, never navigated')
    page.locator('#transport').select_option('online');page.locator('#relay-url').fill('wss://relay.example.com/v1');page.locator('#make-online').click()
    invite=page.locator('#invite-text').input_value();assert invite.startswith('MTO1.');expect(page.locator('#role')).to_have_value('0');expect(page.locator('#network-consent')).not_to_be_checked()
    decoded=page.evaluate("()=>{const c=document.querySelector('#pair-qr'),d=c.getContext('2d').getImageData(0,0,c.width,c.height);return jsQR(d.data,d.width,d.height).data;}")
    assert decoded==invite;passed('Encrypted-online invitation survives actual QR generation and decoding')
    page.locator('#role').select_option('0');page.locator('#qr-input').fill(invite);page.locator('#qr-stage').click();expect(page.locator('#qr-preview')).to_contain_text('relay.example.com');expect(page.locator('#role')).to_have_value('0')
    page.locator('#qr-apply').click();expect(page.locator('#role')).to_have_value('1');expect(page.locator('#network-consent')).not_to_be_checked();expect(page.locator('#consent')).not_to_be_checked();passed('Online preview identifies relay; explicit apply selects B without granting either consent')
    page.locator('#dialogue-mode').select_option('manual');expect(page.locator('#preflight-model')).to_have_text('モデル不要');expect(page.locator('#execution-place')).to_contain_text('AIは呼び出しません');expect(page.locator('#preflight-consent')).to_have_text('ネット交信の許可が必要');page.locator('#listen').click();expect(page.locator('#status')).to_contain_text('許可');passed('Network connection cannot begin without explicit network consent')
    for width in [320,390,768,1280]:
        page.set_viewport_size({'width':width,'height':844});page.wait_for_timeout(80)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
    passed('Large online QR stays inside mobile and desktop viewport widths')
    # A real MediaStream generated from QR canvas substitutes ONLY the physical camera.
    page.evaluate("""()=>{window.cameraCalls=[];Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async opts=>{cameraCalls.push(opts);const c=document.querySelector('#pair-qr');window.cameraStream=c.captureStream(5);window.cameraTicks=setInterval(()=>{c.getContext('2d').fillRect(0,0,1,1);cameraStream.getVideoTracks()[0]?.requestFrame?.();},80);return cameraStream;}},configurable:true});}""")
    page.locator('#scan-qr').click();expect(page.locator('#qr-apply')).to_be_enabled(timeout=10000)
    assert page.evaluate('cameraCalls.length===1 && cameraCalls[0].audio===false && cameraStream.getTracks().every(t=>t.readyState==="ended")')
    page.evaluate('clearInterval(cameraTicks)');passed('Production scanner reads virtual-camera frames and releases camera after detection, without microphone')
    page.locator('#qr-apply').click()
    page.evaluate("""()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>window.giveCamera=resolve);}""")
    page.locator('#scan-qr').click();expect(page.locator('#qr-camera-stop')).to_be_enabled();page.locator('#qr-camera-stop').click()
    page.evaluate("()=>{window.lateStream=document.querySelector('#pair-qr').captureStream(5);giveCamera(lateStream)}")
    page.wait_for_timeout(100);assert page.evaluate('lateStream.getTracks().every(t=>t.readyState==="ended")');passed('Stop before camera permission resolves releases the late-acquired stream')
    page.evaluate("()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError')}}")
    page.locator('#scan-qr').click();expect(page.locator('#status')).to_contain_text('カメラ');expect(page.locator('#scan-qr')).to_be_enabled();passed('Camera denial is recoverable and preserves image/paste alternatives')
    assert not errors,errors;assert not requests,requests;passed('No page exceptions, plaintext script leakage or external requests during offline QR tests')
    page.screenshot(path=str(OUT/'qr-online-screen.png'),full_page=True);browser.close()
(OUT/'qr-ui.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'physicalCamera':False,'network':False},ensure_ascii=False,indent=2))
print(f'{len(checks)} offline QR checks passed.')
