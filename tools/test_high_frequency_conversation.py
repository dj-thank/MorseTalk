"""Verify ten real Gemma turns on two independently receiving Android Signal screens."""
import argparse,asyncio,json,time
from pathlib import Path
from test_high_frequency_devices import Phone
from phone_pair import adb

async def run(args):
    if args.a==args.b:raise ValueError('別々の2台が必要です')
    phones=[Phone(args.a,19391),Phone(args.b,19392)];out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    report={'status':'RUNNING','frequency':args.frequency,'volume':args.volume,'wpm':20,'model':'PC Gemma 4 E2B','snapshots':[]};seen=set()
    def save():(out/'conversation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    try:
        for p in phones:
            for port in [1234,18790]:adb(p.serial,'reverse',f'tcp:{port}',f'tcp:{port}')
            await p.prepare()
        for role in [1,0]:
            settings=json.dumps({'role':str(role),'frequency':str(args.frequency),'speed':'20','volume':str(args.volume),'topic':'AI同士で協力するとき、最初に何を確かめる？'},ensure_ascii=False)
            await phones[role].js('(async()=>{for(const [k,v] of Object.entries('+settings+'))document.getElementById(k).value=v;await document.getElementById("listen").onclick();return true;})()')
        await phones[0].js('document.getElementById("start").click();true')
        deadline=time.monotonic()+1800
        while time.monotonic()<deadline:
            snapshots=[await p.js('morsetalkSignalSnapshot()') for p in phones];report['snapshots']=snapshots;save()
            delivered={e['seq'] for s in snapshots for e in s['events'] if e['kind']=='delivered'}
            for seq in sorted(delivered-seen):print('DELIVERED',seq,flush=True)
            seen|=delivered
            if set(range(1,11))<=delivered:break
            if any(not s['active'] for s in snapshots):raise RuntimeError('10ターン配送前に停止しました')
            await asyncio.sleep(3)
        else:raise TimeoutError('10ターンの制限時間を超えました')
        received={}
        for role,s in enumerate(snapshots):
            assert any(e['kind']=='ready' and e['frequency']==args.frequency for e in s['events'])
            for e in s['events']:
                if e['kind']=='rx' and e['frame']['type']=='data':
                    f=e['frame'];received[(role,f['seq'])]=f
                    sent=next(t for t in snapshots[1-role]['events'] if t['kind']=='tx' and t['type']=='data' and t['seq']==f['seq'])
                    assert f['sender']==1-role and f['text']==sent['kana'] and f['wire']==sent['wire']
            for seq in range(1+role,11,2):
                assert any(e['kind']=='rx' and e['frame']['type']=='ack' and e['frame']['seq']==seq and e['frame']['text']=='じゅしんしました' for e in s['events'])
        for role,s in enumerate(snapshots):
            for e in s['events']:
                if e['kind']=='inference-input' and e['seq']>1:assert e['input']==received[(role,e['seq']-1)]['text']
        # Exercise actual Android background lifecycle, then read back without resuming audio.
        for p in phones:adb(p.serial,'shell','input','keyevent','3')
        await asyncio.sleep(2)
        for p in phones:adb(p.serial,'shell','am','start','-n','jp.morsetalk.app/.MainActivity')
        await asyncio.sleep(1)
        report['backgroundStopped']=[not await p.js('morsetalkSignalSnapshot().active') for p in phones]
        assert all(report['backgroundStopped'])
        report['status']='PASS';save();print('PASS: ten exact acoustic deliveries, voiced ACKs, actual peer inference inputs, background stop',flush=True)
    except Exception as e:report['status']='FAIL';report['error']=str(e);save();raise
    finally:
        for p in phones:
            if hasattr(p,'url'):
                try:await p.js('document.getElementById("stop").click();true')
                except Exception as e:report.setdefault('cleanupErrors',[]).append(str(e))
        save()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--a',required=True);p.add_argument('--b',required=True);p.add_argument('--frequency',required=True,type=int);p.add_argument('--volume',required=True,type=int);p.add_argument('--output',required=True)
    asyncio.run(run(p.parse_args()))
