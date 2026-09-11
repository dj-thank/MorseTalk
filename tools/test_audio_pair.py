#!/usr/bin/env python3
"""Four real-time audio turns with a named AI test double; separate from real LLM proof."""
import json
from browser_support import ROOT, OUT, served_browser, wait_js

def run_pair(*, real_ai=False, model=''):
    with served_browser() as (server, browser):
        page=browser.new_page()
        errors=[]
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(server.origin+'/ai.html')
        function=(ROOT/'tools/audio_pair.mjs').read_text()
        page.evaluate('() => { window.runAudioPair = ' + function + '; }')
        page.evaluate('config => {const b=document.createElement("button");b.id="proof-start";b.textContent="Start runtime proof";b.onclick=()=>{window.proof=null;window.runAudioPair(config).then(x=>window.proof=x).catch(e=>window.proof={ok:false,error:String(e)});};document.body.append(b);}', {'realAI':real_ai,'model':model,'wpm':1200})
        page.locator('#proof-start').click()
        try:
            wait_js(page, '() => window.proof !== null && window.proof !== undefined', timeout_ms=270000 if real_ai else 75000)
            result=page.evaluate('() => window.proof')
        except Exception as exc:
            result={'ok':False,'error':str(exc),'physicalDevices':False,'realAI':real_ai}
            try:
                result['partialProof']=page.evaluate('() => window.proof ?? null')
            except Exception:
                pass
        result['pageErrors']=errors
        path=OUT/('real-ai-audio.json' if real_ai else 'realtime-audio-pair.json')
        path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        print(json.dumps(result,ensure_ascii=False,indent=2),flush=True)
        assert result.get('ok'), result.get('error')
        assert result.get('captureTracksEnded'), 'Capture tracks leaked'
        assert not errors, errors
        return result

if __name__=='__main__':
    run_pair()
