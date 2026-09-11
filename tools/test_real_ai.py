#!/usr/bin/env python3
"""Fail-closed real Ollama inference -> production live audio -> peer model proof."""
import json
import os
import urllib.request
from browser_support import OUT
from test_audio_pair import run_pair
if __name__=='__main__':
    model=os.environ.get('MORSETALK_AI_MODEL','gemma4:e2b-it-qat')
    os.environ['MORSETALK_AI_MODEL']=model
    os.environ['MORSETALK_AI_ENABLED']='1'
    with urllib.request.urlopen('http://127.0.0.1:11434/api/tags',timeout=10) as response:
        inventory=json.load(response)
    assert any(m.get('name')==model and m.get('digest') for m in inventory['models']), 'Model absent; no stub/fallback allowed'
    (OUT/'model-inventory.json').write_text(json.dumps(inventory,indent=2))
    run_pair(real_ai=True,model=model)

# Run the production agent/model adapter on diverse topics separately from real-time audio.
if __name__ == '__main__':
    from test_conversation_topics import main as test_topics
    test_topics()
