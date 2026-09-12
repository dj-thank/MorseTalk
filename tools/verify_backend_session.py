"""Real-model backend proof, without a browser executing either agent."""
import asyncio,json,argparse
from pathlib import Path
from websockets.asyncio.client import connect

async def run(url,out,language,topic):
    events=[]
    async with connect(url+'/view') as view:
        await view.recv()
        async def record():
            async for raw in view:events.append(json.loads(raw))
        reader=asyncio.create_task(record())
        async with connect(url+'/conversation',origin=url.replace('ws:','http:')) as owner:
            await owner.send(json.dumps({'kind':'start','consent':True,'topic':topic or ('Why does music change your mood?' if language=='en' else '音楽で気分が変わるのはどうして？'),'language':language,'wpm':60,'maxTurns':4}))
            result=json.loads(await asyncio.wait_for(owner.recv(),180))
        await asyncio.sleep(.1);reader.cancel();await asyncio.gather(reader,return_exceptions=True)
    out.mkdir(parents=True,exist_ok=True)
    (out/'backend-session.json').write_text(json.dumps({'result':result,'events':events},ensure_ascii=False,indent=2),encoding='utf-8')
    assert result.get('complete') and not result.get('error'),result
    sessions=[e for e in events if e.get('kind')=='session']
    assert len(sessions)==2 and len({s['worker'] for s in sessions})==2
    tx=[e for e in events if e.get('kind')=='phonetic-tx' and e.get('type')=='data']
    frames=[e for e in events if e.get('kind')=='frame' and e['frame']['type']=='data']
    generated=[e for e in events if e.get('kind')=='generated']
    delivered=[e for e in events if e.get('kind')=='delivered']
    assert len(tx)==len(frames)==len(generated)==len(delivered)==4
    for sent in tx:
        received=next(e for e in frames if e['frame']['seq']==sent['seq'])
        assert received['role']==1-sent['role'] and received['frame']['text']==sent['text']
        marks=[e for e in events if e.get('kind')=='mark' and e.get('signalSeq')==sent['seq'] and e.get('signalType')=='data' and e.get('on')]
        chars=[e for e in events if e.get('kind')=='phonetic-character' and e.get('seq')==sent['seq']]
        assert marks and all(e.get('signalSender')==sent['role'] and e.get('role')==1-sent['role'] for e in marks)
        assert chars and all(e.get('sender')==sent['role'] and e.get('role')==1-sent['role'] for e in chars)
    inputs=[e for e in events if e.get('kind')=='inference-input']
    for request in inputs:
        if request['seq']==1:continue
        peer=next(e for e in frames if e['frame']['seq']==request['seq']-1)
        assert request['input']==peer['frame']['text'] and request['role']==peer['role']
    replies=[e for e in events if e.get('kind')=='model-reply']
    assert len(replies)>=3 and all('gemma' in e['model'].lower() for e in replies)
    awareness=[e for e in events if e.get('kind')=='agent-awareness']
    assert len(awareness)>=4 and awareness[0]['role']==0 and awareness[0]['source']=='topic'
    assert all(e['self']==e['role'] and e['peer']==1-e['role'] and e['received'] and e['focus'] for e in awareness)
    assert any(e.get('kind')=='mark' for e in events) and any(e.get('kind')=='phonetic-character' for e in events)
    assert any(e.get('kind')=='phonetic-character' and e.get('text') for e in events)
    assert not any(e.get('kind') in ('invalid','error','timeout') for e in events)
    print(json.dumps({'status':'PASS','workers':sorted({s['worker'] for s in sessions}),'turns':len(tx),'llmCalls':len(replies),'pcmDecodeAndACK':True},ensure_ascii=False),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--url',default='ws://127.0.0.1:18790');p.add_argument('--language',choices=['ja','en'],default='ja');p.add_argument('--topic');p.add_argument('--out',required=True);a=p.parse_args();asyncio.run(run(a.url,Path(a.out),a.language,a.topic))
