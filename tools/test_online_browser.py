#!/usr/bin/env python3
"""Two real browser contexts, real WebSocket relay and QR PNG invitation.
Default is manual text (no model); --real-ai requires actual configured Ollama.
Loopback TCP is a real network stack, NOT an internet deployment or physical phones.
"""
import argparse,json,os,socket,subprocess,sys,time,urllib.request
from browser_support import ROOT,OUT,served_browser,wait_js
from playwright.sync_api import expect

def main(real_ai=False):
    model=os.environ.get('MORSETALK_AI_MODEL','gemma4:e2b-it-qat')
    if real_ai:
        os.environ['MORSETALK_AI_ENABLED']='1';os.environ['MORSETALK_AI_MODEL']=model
        with urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=10) as r:inventory=json.load(r)
        assert any(m.get('name')==model and m.get('digest') for m in inventory['models']), 'Real model required; no fallback'
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    env={**os.environ,'HOST':'127.0.0.1','PORT':str(port)}
    process=subprocess.Popen([sys.executable,'relay/server.py'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    checks=[];report={'ok':False,'realLLM':real_ai,'transport':'encrypted Morse symbols / WebSocket / loopback TCP','publicInternet':False,'physicalDevices':False,'checks':checks}
    def check(text):checks.append(text);print('PASS',text,flush=True)
    try:
        for _ in range(100):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz',timeout=.2):break
            except Exception:time.sleep(.05)
        else:raise AssertionError('Relay startup failed')
        with served_browser() as (server,browser):
            contexts=[browser.new_context(viewport={'width':1000,'height':900}) for _ in range(2)]
            pages=[c.new_page() for c in contexts];errors=[];wire=[]
            for page in pages:
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('websocket',lambda ws:ws.on('framesent',lambda msg:wire.append(msg)))
                page.add_init_script("window.captureCalls=0;navigator.mediaDevices.getUserMedia=async()=>{captureCalls++;throw Error('Network mode must not request microphone or camera');};")
                page.goto(server.origin+'/ai.html')
            a,b=pages
            a.locator('#transport').select_option('online');a.locator('#relay-url').fill(f'ws://127.0.0.1:{port}/v1')
            a.locator('summary').filter(has_text='会話の制限・音量').click();a.locator('#turns').fill('4')
            a.locator('#make-online').click();invite=a.locator('#invite-text').input_value();assert invite.startswith('MTO1.')
            with a.expect_download() as saved:a.locator('#qr-save').click()
            png=OUT/('online-ai-invite.png' if real_ai else 'online-manual-invite.png');saved.value.save_as(png)
            b.locator('#qr-image').set_input_files(str(png));expect(b.locator('#qr-apply')).to_be_enabled();expect(b.locator('#transport')).to_have_value('acoustic')
            b.locator('#qr-apply').click();expect(b.locator('#role')).to_have_value('1');expect(b.locator('#transport')).to_have_value('online');check('Actual QR PNG import with explicit confirmation sets the second browser to B')
            # Never retain a live invitation in published artifacts.
            png.unlink()
            for page in pages:
                page.locator('#network-consent').check()
                page.locator('#dialogue-mode').select_option('ai' if real_ai else 'manual')
                if real_ai:
                    page.locator('#model').fill(model);page.locator('#consent').check()
                    page.locator('#goal').fill('防災用品を一つずつ日本語15文字以内の一文で具体的に提案する。')
            started=time.monotonic();b.locator('#listen').click();a.locator('#listen').click()
            if real_ai:
                expect(a.locator('#start')).to_be_enabled(timeout=15000);a.locator('#topic').is_disabled()
                a.locator('#start').click()
                for page in pages:expect(page.locator('#turn-count')).to_have_text('4 / 4',timeout=240000)
                texts=[p.evaluate("()=>Object.fromEntries(['local','peer'].map(kind=>[kind,[...document.querySelectorAll('#transcript .'+kind)].map(e=>[...e.childNodes].slice(1).map(n=>n.textContent).join(''))]))") for p in pages]
                assert texts[0]['local']==texts[1]['peer'] and texts[1]['local']==texts[0]['peer'],texts
                assert all(len(x['local'])==len(x['peer'])==2 for x in texts),texts
                report.update(model=model,transcripts=texts,humanTopicSeed=True,aiGeneratedTurns=3)
                check('Actual Gemma A/B complete four acknowledged turns over encrypted network Morse')
            else:
                expect(a.locator('#manual-send')).to_be_enabled(timeout=15000);expect(b.locator('#manual-send')).to_be_disabled()
                texts=['こんにちは。聞こえますか？','はい、届いています。','漢字と絵文字も送ります。🙂','正確に受信しました。']
                for i,text in enumerate(texts):
                    sender,receiver=pages[i%2],pages[1-i%2]
                    expect(sender.locator('#manual-send')).to_be_enabled(timeout=10000)
                    sender.locator('#manual-message').fill(text);sender.locator('#manual-send').click()
                    expect(receiver.locator('#transcript .peer').last).to_contain_text(text,timeout=10000)
                    expect(sender.locator('#transcript')).to_contain_text(f'ターン {i+1} が相手に到達',timeout=10000)
                expect(a.locator('#manual-send')).to_be_disabled();expect(b.locator('#manual-send')).to_be_disabled()
                report['transcript']=texts;check('Four manual Japanese/emoji messages arrive exactly, with ACK and enforced alternating turns')
                assert all(not p.locator('#consent').is_checked() for p in pages);check('Manual network communication requires no AI model consent or inference')
            report['elapsedSeconds']=round(time.monotonic()-started,4)
            assert all(p.evaluate('captureCalls===0') for p in pages);check('Online exchange makes zero microphone/camera calls and does not synthesize audio')
            # WebCrypto encryption must conceal all actual test messages and the invite secret from the relay.
            secret=a.evaluate("s=>JSON.parse(atob(s.slice(5).replaceAll('-','+').replaceAll('_','/'))).k",invite)
            raw='\n'.join(str(x) for x in wire);assert secret not in raw;assert 'MTO1.' not in raw;assert not any('\u3040'<=ch<='\u9fff' for ch in raw)
            check('Observed relay frames contain neither the invitation secret nor Japanese conversation plaintext')
            a.locator('#stop').click();expect(b.locator('#listen')).to_be_enabled(timeout=10000);expect(b.locator('#stop')).to_be_disabled()
            check('Disconnect on one side stops the other side; no automatic reconnect or late AI send')
            for p in pages:
                p.evaluate("document.querySelector('#invite-text').value='';document.querySelector('#qr-output').hidden=true;document.querySelector('#qr-input').value='';")
            a.screenshot(path=str(OUT/('online-gemma-screen.png' if real_ai else 'online-manual-screen.png')),full_page=True)
            assert not errors,errors;report.update(ok=True,pageErrors=errors,websocketFrames=len(wire))
    except Exception as exc:report['error']=str(exc);raise
    finally:
        process.terminate()
        try:process.communicate(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.communicate()
        (OUT/('online-real-gemma.json' if real_ai else 'online-browser.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)
if __name__=='__main__':
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8',errors='replace')
    parser=argparse.ArgumentParser();parser.add_argument('--real-ai',action='store_true');main(parser.parse_args().real_ai)
