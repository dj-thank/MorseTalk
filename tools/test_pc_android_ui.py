#!/usr/bin/env python3
"""Rendered USB setup controls; no ADB, physical device or model in this test."""
import json
from pathlib import Path
import shutil
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or None,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844});errors=[];requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:requests.append(r.url))
    page.set_content((ROOT/'dist/MorseTalk-AI-Portable.html').read_text())
    page.locator('#pc-android-guide > summary').click()
    page.locator('#use-usb').click()
    expect(page.locator('#transport')).to_have_value('online')
    expect(page.locator('#relay-url')).to_have_value('ws://127.0.0.1:8787/v1')
    expect(page.locator('#network-consent')).not_to_be_checked()
    expect(page.locator('#consent')).not_to_be_checked()
    expect(page.locator('#stop')).to_be_disabled()
    checks.append('USB setup only sets local relay, with no connection, camera, inference or consent')
    page.locator('#make-online').click();expect(page.locator('#invite-text')).not_to_be_empty()
    page.locator('#network-consent').check();page.locator('#use-usb').click()
    expect(page.locator('#invite-text')).to_have_value('');expect(page.locator('#qr-output')).to_be_hidden()
    expect(page.locator('#qr-apply')).to_be_disabled();expect(page.locator('#network-consent')).not_to_be_checked()
    checks.append('Switching to USB invalidates previous invitation and network consent')
    page.locator('#dialogue-mode').select_option('manual');page.locator('#listen').click()
    expect(page.locator('#status')).to_contain_text('許可');expect(page.locator('#preflight-model')).to_have_text('モデル不要')
    checks.append('Manual PC/phone exchange still requires network permission, never an AI model')
    for width in [320,390,768,1280]:
        page.set_viewport_size({'width':width,'height':844})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    checks.append('PC/Android guide fits four viewport widths')
    assert not errors,errors;assert not requests,requests
    checks.append('No page error or external request in setup-only operation')
    page.screenshot(path=str(OUT/'pc-android-setup.png'),full_page=True);browser.close()
(OUT/'pc-android-ui.json').write_text(json.dumps({'passed':len(checks),'checks':checks,'realADB':False},ensure_ascii=False,indent=2))
print(f'PASS {len(checks)} PC/Android setup UI checks')
