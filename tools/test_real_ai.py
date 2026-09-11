#!/usr/bin/env python3
"""Independent actual-model audio and topic proofs; fail if either fails.
A faulty audio path must not hide topic/language evidence, or vice versa.
"""
import json
import os
import traceback
import urllib.request
from browser_support import OUT
from test_audio_pair import run_pair
from test_conversation_topics import main as test_topics


def main():
    model=os.environ.get('MORSETALK_AI_MODEL','gemma4:e2b-it-qat')
    os.environ['MORSETALK_AI_MODEL']=model
    os.environ['MORSETALK_AI_ENABLED']='1'
    with urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=10) as response:
        inventory=json.load(response)
    assert any(m.get('name')==model and m.get('digest') for m in inventory['models']), 'Model absent; no stub/fallback allowed'
    (OUT/'model-inventory.json').write_text(json.dumps(inventory,indent=2),encoding='utf-8')
    results=[]
    for name,execute in [('realtime-audio',lambda:run_pair(real_ai=True,model=model)),
                         ('topics-and-language-repair',test_topics)]:
        result={'name':name,'ok':False}
        try:
            execute()
            result['ok']=True
        except Exception as exc:
            result['error']=str(exc)
            traceback.print_exc()
        results.append(result)
        (OUT/'real-model-suite.json').write_text(json.dumps({'ok':all(r['ok'] for r in results),'checks':results},ensure_ascii=False,indent=2),encoding='utf-8')
    assert all(r['ok'] for r in results), results


if __name__=='__main__':main()
