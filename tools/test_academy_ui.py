#!/usr/bin/env python3
"""Chromium UI tests. Native AI bridge and storage are EXPLICIT TEST DOUBLES.
All rendering and Web Audio playback execute in Chromium without network.
Origin-backed persistence is covered by serialization unit tests, not this fixture.
"""
import json, os, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'test-results'/'academy'
FIXTURE='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Academy test harness</title><body><main><header>Existing AI Link test fixture</header><section id="connection-settings"><input id="model" value="explicit-test-double"><input id="consent" type="checkbox"><select id="provider"><option>ollama</option></select><input id="endpoint" value="http://127.0.0.1:11434/api/chat"><select id="local-backend"><option>cpu</option></select></section></main><script>__SCRIPT__</script></body></html>'''
def run():
    OUT.mkdir(parents=True,exist_ok=True)
    script=subprocess.check_output(['node',str(ROOT/'tools/build_academy_preview.mjs'),'--script-only'],text=True)
    fixture="""window.__calls=[];window.__reply='HI';window.__delay=0;
    const store=new Map();Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)}});
    window.NativeBridge={request(raw){const d=JSON.parse(raw);window.__calls.push(d);const result=d.method==='aiChat'?{text:window.__reply}:{};setTimeout(()=>window.dispatchEvent(new CustomEvent('morsetalk-native-result',{detail:{id:d.id,ok:true,result}})),d.method==='aiChat'?window.__delay:0);}};
    Math.random=()=>0;
    """
    html=FIXTURE.replace('__SCRIPT__',fixture+script)
    results=[]
    def check(name,condition=True):
        if not condition: raise AssertionError(name)
        results.append(name)
    with sync_playwright() as pw:
        binary=os.environ.get('CHROMIUM_PATH')
        browser=pw.chromium.launch(**({'executable_path':binary} if binary else {}),args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':1440,'height':1080},device_scale_factor=1)
        errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
        page.set_content(html)
        def calls():return page.evaluate("window.__calls.filter(c=>c.method==='aiChat')")
        expect(page.locator('#ac-title')).to_have_text('今日も、ひとつの信号から。')
        page.screenshot(path=str(OUT/'desktop.png'),full_page=True)
        check('initial metrics are real zero',page.locator('#ac-attempts').inner_text().startswith('0'))
        check('initial AI requests zero',not calls())
        def nav(name):page.locator(f'.ac-nav [data-page="{name}"]').click()
        def fast():page.locator('#ac-char-wpm').select_option('40');page.locator('#ac-effective-wpm').select_option('40')
        def play():
            page.locator('#ac-play').click();expect(page.locator('#ac-check')).to_be_enabled(timeout=15000)
        nav('listen');fast()
        check('cannot grade before hearing signal',page.locator('#ac-check').is_disabled())
        check('answer concealed','K' not in page.locator('#ac-prompt').inner_text())
        play();page.locator('#ac-answer').fill('K');page.locator('#ac-check').click();expect(page.locator('#ac-result')).to_contain_text('100%')
        check('real Web Audio completion enables grading')
        check('cannot grade twice',page.locator('#ac-check').is_disabled())
        page.locator('#ac-next').click();play();page.locator('#ac-reveal').click();page.locator('#ac-answer').fill('K');page.locator('#ac-check').click()
        expect(page.locator('#ac-result')).to_contain_text('補助あり');check('reveal is marked assisted')
        saved=page.evaluate('JSON.parse(localStorage.getItem("morsetalk-academy-v1"))')
        check('persistent counts correct',saved['attempts']==2 and saved['exact']==1 and saved['aided']==1)
        check('serialized UI progress contains real symbol statistics',saved['symbols']['international:listen:K']['hits']==1)
        nav('send');fast();page.locator('#ac-dash').click();page.locator('#ac-dot').click();page.locator('#ac-dash').click();page.locator('#ac-send').click()
        expect(page.locator('#ac-result')).to_contain_text('100%');expect(page.locator('#ac-result')).to_contain_text('補助あり');check('assisted input roundtrips K')
        page.locator('#ac-next').click();key=page.locator('#ac-key');key.focus();page.keyboard.down('Space');page.wait_for_timeout(90);page.keyboard.up('Space')
        expect(page.locator('#ac-code')).to_contain_text('−');check('keyboard hold decoded as dash')
        page.locator('#ac-clear').click();key.focus();page.keyboard.down('Space');page.evaluate('dispatchEvent(new Event("blur"))');page.keyboard.up('Space')
        check('blur cancels incomplete mark','ここに' in page.locator('#ac-code').inner_text())
        box=key.bounding_box();page.mouse.move(box['x']+20,box['y']+20);page.mouse.down();page.wait_for_timeout(90);page.mouse.up()
        expect(page.locator('#ac-code')).to_contain_text('−');check('actual pointer hold works')
        page.locator('#ac-stop').click();check('stop clears signal',page.locator('#academy-root').get_attribute('data-signal')=='off')
        nav('dictionary');page.locator('#ac-mode').select_option('wabun');check('Wabun includes KE',page.get_by_role('button',name='ケのモールス信号を再生',exact=True).count()==1)
        page.get_by_role('button',name='ケのモールス信号を再生',exact=True).click();expect(page.get_by_role('button',name='ケのモールス信号を再生',exact=True)).to_be_enabled(timeout=10000);check('dictionary audio completes')
        nav('chat');page.locator('#ac-mode').select_option('international');fast()
        page.locator('#ac-compose-tools').evaluate('(e)=>e.open=true');page.locator('#ac-compose').fill('HI');page.locator('#ac-compose-code').click();page.locator('#ac-send').click()
        expect(page.locator('#ac-status')).to_contain_text('許可');check('no AI request without consent',not calls())
        page.locator('#ac-compose').focus();page.keyboard.press('Space');check('space in input not hijacked',page.locator('#ac-compose').input_value().endswith(' '))
        page.evaluate('document.getElementById("consent").checked=true')
        page.locator('#ac-send').click();expect(page.locator('#ac-status')).to_contain_text('返答を受信',timeout=20000)
        check('API receives decoded Morse (native bridge double)',calls()[-1]['params']['messages'][-1]['content']=='HI')
        check('AI plaintext concealed','HI' not in page.locator('.ac-bubble[data-who=ai]').inner_text())
        page.locator('#ac-reveal').click();expect(page.locator('.ac-bubble[data-who=ai]')).to_contain_text('HI');check('AI output encoded played and revealed (native bridge double)')
        page.locator('#ac-chat-mode').select_option('exam');page.locator('#ac-ai-question').click();expect(page.locator('#ac-check')).to_be_enabled(timeout=20000)
        page.locator('#ac-answer').fill('HI');page.locator('#ac-check').click();expect(page.locator('#ac-result')).to_contain_text('100%');check('AI examiner and grading (native bridge double)')
        page.evaluate("window.__reply='Invalid 😀'")
        page.locator('#ac-ai-question').click();expect(page.locator('#ac-status')).to_contain_text('変換できません');check('invalid AI text stopped before playback')
        page.locator('#ac-chat-reset').click();page.evaluate("window.__reply='LATE';window.__delay=400")
        page.locator('#ac-ai-question').click();page.locator('#ac-stop').click();page.wait_for_timeout(450)
        check('late reply not displayed after stop','LATE' not in page.locator('#ac-thread').inner_text())
        nav('exam');fast();page.locator('#ac-exam-start').click()
        for n in range(10):
            play();page.locator('#ac-answer').fill('KKK');page.locator('#ac-check').click();page.locator('#ac-next').click()
        expect(page.locator('#ac-result')).to_contain_text('10 / 10');check('ten-question test completed without injected scores')
        nav('home')
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':844});check(f'no overflow {width}px',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(OUT/'mobile.png'),full_page=True)
        nav('chat');page.screenshot(path=str(OUT/'mobile-chat.png'),full_page=True);check('no mobile chat overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.locator('#ac-settings').click();expect(page.locator('#academy-root')).to_be_hidden();check('settings restores original controls',not page.locator('body>main').evaluate('(e)=>e.inert'))
        check('no unhandled browser exceptions',not errors)
        browser.close()
    report={'passed':len(results),'checks':results,'ai':'explicit NativeBridge test double, not actual LLM','audio':'real Chromium Web Audio; no physical speaker/phone measurements','storage':'explicit in-memory Storage double; unit tests validate persistence serialization'}
    (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__':run()
