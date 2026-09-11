#!/usr/bin/env python3
"""Real configured Gemma, 10 topics x 4 turns, 3 additional styles and a topic switch.
Production model adapter/agent/PCM decoder; numerical PCM only, not air or real-time audio.
No stub replies or permissive fallback. Semantic quality is reported for human review.
"""
import json,os,urllib.request
from browser_support import ROOT,OUT,served_browser,wait_js

def main():
    model=os.environ.get('MORSETALK_AI_MODEL','gemma4:e2b-it-qat')
    os.environ['MORSETALK_AI_ENABLED']='1';os.environ['MORSETALK_AI_MODEL']=model
    with urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=10) as r: inventory=json.load(r)
    actual=next((m for m in inventory['models'] if m.get('name')==model and m.get('digest')),None)
    assert actual, 'Actual model is required; test double/fallback not allowed'
    report={'ok':False,'model':model,'digest':actual['digest'],'transport':'numerical PCM Morse / production decoder',
            'physicalDevices':False,'realTimeAudio':False,'semanticQuality':'Raw transcripts for human review; no automated correctness claim.', 'cases':[]}
    try:
        with served_browser() as (server,browser):
            page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(server.origin+'/ai.html')
            page.evaluate('() => {window.topicProof = '+(ROOT/'tools/conversation_topics.mjs').read_text()+';}')
            cases=[{'topic':x,'style':'natural'} for x in ['daily','music','food','travel','science','technology','learning','games','creative','philosophy']]
            cases += [{'topic':'technology','style':x} for x in ['brainstorm','discuss','interview']]
            cases += [{'topic':'music','style':'natural','switchTopic':'少ない材料で作れる料理の話をしよう。','turns':6}]
            for case in cases:
                page.evaluate('cfg=>{window.currentResult=null;topicProof(cfg).then(x=>currentResult=x).catch(e=>currentResult={ok:false,error:String(e)});}',{**case,'model':model})
                wait_js(page,'()=>window.currentResult!==null',timeout_ms=300000)
                result=page.evaluate('()=>currentResult');report['cases'].append(result)
                print(json.dumps(result,ensure_ascii=False),flush=True)
                assert result.get('ok'), result.get('error')
            assert not errors,errors
            report.update(ok=True,pageErrors=errors)
    finally:
        (OUT/'conversation-real-gemma.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print('PASS real Gemma: 10 topic conversations, 3 additional styles, 1 human topic switch; numerical PCM only.',flush=True)
if __name__=='__main__':main()
