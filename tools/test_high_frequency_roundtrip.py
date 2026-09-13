"""Twenty real DATA/voiced-ACK deliveries per candidate, with independent receivers."""
import argparse,asyncio,json,time
from pathlib import Path
from test_high_frequency_devices import Phone

async def run(args):
    if args.a==args.b:raise ValueError('別々の2台が必要です')
    phones=[Phone(args.a,19391),Phone(args.b,19392)];out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    report={'frequency':args.frequency,'volume':args.volume,'wpm':20,'started':time.time(),'trials':[],'status':'RUNNING'}
    def save():(out/'roundtrip.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    words=['な','わ','はい','いいえ','あい','おと','きく','おくる','つぎ','おわり']
    try:
        for p in phones:await p.prepare()
        for trial,text in enumerate(words,1):
            for i,p in enumerate(phones):await p.start(i,args.frequency,args.volume)
            hard_failure=False
            for sender,seq in [(0,1),(1,2)]:
                begin=time.time();failure=None;result=None
                try:result=await phones[sender].js('signalProbe.send('+json.dumps(text,ensure_ascii=False)+','+str(seq)+').then(r=>r)')
                except Exception as e:failure=str(e)
                await asyncio.sleep(1.8)
                snapshots=[await p.snapshot() for p in phones]
                received=[e for e in snapshots[1-sender]['events'] if e['kind']=='receive' and e.get('seq')==seq]
                acks=[e['frame'] for e in snapshots[sender]['events'] if e['kind']=='frame' and e['frame']['type']=='ack' and e['frame']['seq']==seq]
                match=len(received)==1 and received[0]['text']==text and any(f['text']=='じゅしんしました' for f in acks)
                entry={'trial':trial,'sender':sender,'seq':seq,'text':text,'delivered':bool(result and result.get('delivered') and match),'attempts':result.get('attempts') if result else None,'receivedCount':len(received),'ackTexts':[f['text'] for f in acks],'error':failure,'seconds':time.time()-begin}
                report['trials'].append(entry);save();print(json.dumps(entry,ensure_ascii=False),flush=True)
                hard_failure|=not entry['delivered']
                (out/f'trial-{trial}-{sender}.json').write_text(json.dumps(snapshots,ensure_ascii=False),encoding='utf-8')
            for p in phones:await p.stop()
            if hard_failure:break
        report['directions']=[{'sender':i,'firstAttempt':sum(t['delivered'] and t['attempts']==1 for t in report['trials'] if t['sender']==i),'delivered':sum(t['delivered'] for t in report['trials'] if t['sender']==i)} for i in [0,1]]
        report['status']='PASS' if all(d['firstAttempt']>=9 and d['delivered']==10 for d in report['directions']) else 'FAIL'
        if report['status']=='FAIL' and len(report['trials'])<20:report['termination']='Stopped after a failed delivery made 10/10 mathematically impossible.'
        save();print(json.dumps(report['directions']),report['status'],flush=True)
    except Exception as e:report['status']='ERROR';report['error']=str(e);save();raise
    finally:
        for p in phones:
            if hasattr(p,'url'):
                try:await p.stop()
                except Exception as e:report.setdefault('cleanupErrors',[]).append(str(e))
        report['finished']=time.time();save()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--a',required=True);p.add_argument('--b',required=True);p.add_argument('--frequency',required=True,type=int);p.add_argument('--volume',required=True,type=int);p.add_argument('--output',required=True)
    asyncio.run(run(p.parse_args()))
