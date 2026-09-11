#!/usr/bin/env python3
"""Owned bundled UI/PCM with explicit native/LLM test doubles; no actual model or hardware."""
import json, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results';OUT.mkdir(exist_ok=True)
checks=[]
def check(s): checks.append(s); print('PASS',s,flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=shutil.which('chromium') or None,headless=True,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':390,'height':844});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.evaluate('''()=>{
      window.calls=[];window.pending=[];window.hold=false;
      const result=(id,text)=>dispatchEvent(new CustomEvent('morsetalk-native-result',{detail:{id,ok:true,result:text}}));
      window.release=()=>{for(const d of pending.splice(0))result(d.id,{text:'明示的テスト応答 '+d.number+'。'});};
      window.NativeBridge={request(raw){const d=JSON.parse(raw);
        if(d.method==='aiCapabilities')result(d.id,{native:true,provider:'ollama',endpoint:'http://127.0.0.1:11434/api/chat',model:'EXPLICIT TEST DOUBLE'});
        else if(d.method==='aiChat'){calls.push(d.params);d.number=calls.length;if(hold)pending.push(d);else setTimeout(()=>result(d.id,{text:'明示的テスト応答 '+d.number+'。'}),20);}
        else if(d.method==='localModelStatus')result(d.id,{busy:false});
        else result(d.id,{});
      }};
    }''')
    page.set_content((ROOT/'dist/MorseTalk-AI-Portable.html').read_text())
    expect(page.locator('#conversation-single')).to_be_enabled();expect(page.locator('#queue-topic')).to_be_disabled()
    for id in ['daily','music','food','travel','science','technology','learning','games','creative','philosophy']:
        page.locator('#preset').select_option(id)
        assert page.locator('#topic').input_value().strip()
    assert page.evaluate('calls.length')==0;expect(page.locator('#consent')).not_to_be_checked();check('Ten topic presets do not grant consent, load models or start conversation')
    page.locator('#conversation-style').select_option('interview');page.locator('#topic').fill('自由に入力した音楽の話題')
    page.locator('#conversation-single').click();expect(page.locator('#status')).to_contain_text('許可');assert page.evaluate('calls.length')==0
    check('Single-device conversation uses editable topic/style but still requires AI consent')
    page.locator('#consent').check();page.evaluate('hold=true');page.locator('#conversation-single').click()
    expect(page.locator('#queue-topic')).to_be_enabled();expect(page.locator('#conversation-style')).to_be_disabled();expect(page.locator('#preset')).to_be_disabled()
    page.locator('#next-topic').fill('料理の話をしよう。');page.locator('#queue-topic').click()
    expect(page.locator('#topic-status')).to_contain_text('ターン3');expect(page.locator('#queue-topic')).to_be_disabled();expect(page.locator('#cancel-topic')).to_be_enabled()
    check('In-flight generation can reserve exactly one human topic for next local turn')
    page.locator('#cancel-topic').click();expect(page.locator('#queue-topic')).to_be_enabled()
    page.locator('#next-topic').fill('宇宙の話をしよう。');page.locator('#queue-topic').click()
    page.evaluate('hold=false;release()')
    expect(page.locator('#status')).to_contain_text('PCM仮想経路テストが終了',timeout=30000)
    expect(page.locator('#turn-count')).to_have_text('8 / 8')
    expect(page.locator('#transcript')).to_contain_text('あなたの話題変更 · ターン 3')
    assert page.locator('#transcript .peer').filter(has_text='話題を変えよう。宇宙の話をしよう。').count()==1
    calls=page.evaluate('calls');assert len(calls)==7
    assert '自由に入力した音楽の話題' in calls[0]['messages'][-1]['content']
    assert '質問して深掘り' in calls[0]['messages'][0]['content']
    assert calls[2]['messages'][-1]['content']=='話題を変えよう。宇宙の話をしよう。'
    assert all('料理の話' not in str(call) for call in calls)
    check('Human steering is a labelled actual Morse turn, consumes a turn and reaches peer AI without a direct-text bypass')
    expect(page.locator('#queue-topic')).to_be_disabled();expect(page.locator('#conversation-single')).to_be_enabled()
    check('At finite turn limit, controls recover and no extra model call is made')
    page.evaluate('hold=true');page.locator('#conversation-single').click();expect(page.locator('#queue-topic')).to_be_enabled()
    page.locator('#next-topic').fill('未送信の話題');page.locator('#queue-topic').click();page.locator('#quick-stop').click()
    before=page.locator('#transcript .local').count();page.evaluate('hold=false;release()');page.wait_for_timeout(150)
    assert page.locator('#transcript .local').count()==before;expect(page.locator('#queue-topic')).to_be_disabled()
    check('Stop cancels queued topic and ignores late generated output')
    for width in [320,390,768,1280]:
        page.set_viewport_size({'width':width,'height':844});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    check('New topic and style controls fit compact mobile and desktop widths')
    page.set_viewport_size({'width':1000,'height':950});page.locator('#conversation-panel').screenshot(path=str(OUT/'conversation-panel.png'))
    assert not errors,errors;check('No page exceptions in the new conversation controls')
    browser.close()
(OUT/'conversation-ui.json').write_text(json.dumps({'checks':checks,'passed':len(checks),'realModel':False,'physicalTransport':False},ensure_ascii=False,indent=2))
