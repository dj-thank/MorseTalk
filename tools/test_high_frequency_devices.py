"""Two explicitly selected physical phones; ADB controls tests, never carries peer audio/text.
Keep both Signal screens foreground. Results contain levels/decoded symbols, not microphone recordings.
"""
import argparse,asyncio,json,math,os,time,urllib.request
from pathlib import Path
import websockets
from phone_pair import adb

def percentile(values,p):
    values=sorted(values)
    return values[min(len(values)-1,int((len(values)-1)*p))] if values else 0

class Phone:
    def __init__(self,serial,port):self.serial,self.port=serial,port
    async def prepare(self):
        adb(self.serial,'shell','am','start','-n','jp.morsetalk.app/.MainActivity')
        await asyncio.sleep(1)
        pid=adb(self.serial,'shell','pidof','jp.morsetalk.app').split()[0]
        adb(self.serial,'forward',f'tcp:{self.port}',f'localabstract:webview_devtools_remote_{pid}')
        pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{self.port}/json',timeout=5))
        self.url=next(p['webSocketDebuggerUrl'] for p in pages if '/signal.html' in p.get('url',''))
        await self.js("document.querySelector('#stop').click();true")
    async def js(self,expression):
        async with websockets.connect(self.url,max_size=16*1024*1024) as ws:
            await ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expression,'awaitPromise':True,'returnByValue':True}}))
            while True:
                m=json.loads(await asyncio.wait_for(ws.recv(),190))
                if m.get('id')==1:
                    if 'exceptionDetails' in m['result']:raise RuntimeError(str(m['result']['exceptionDetails']))
                    return m['result'].get('result',{}).get('value')
    async def start(self,role,frequency,volume):
        options=json.dumps(dict(role=role,frequency=frequency,volume=volume))
        return await self.js("(async()=>{globalThis.signalProbe?.stop();const m=await import('/js/signal-probe.mjs');globalThis.signalProbe=await m.createSignalProbe("+options+");document.querySelector('#state').textContent='帯域測定中';return signalProbe.snapshot();})()")
    async def snapshot(self):return await self.js('signalProbe.snapshot()')
    async def stop(self):return await self.js("signalProbe?.stop();document.querySelector('#state').textContent='停止';true")

async def run(args):
    if args.a==args.b:raise ValueError('別々の端末を指定してください')
    phones=[Phone(args.a,19391),Phone(args.b,19392)]
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    report={'owner':'MorseTalk high-frequency test','pid':os.getpid(),'started':time.time(),'devices':[args.a,args.b],'wpm':20,'audibility':'not yet reported','measurements':[]}
    def save():(out/'sweep.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    try:
        for p in phones:await p.prepare()
        for frequency in args.frequencies:
            for volume in [20,40,60]:
                info=[await p.start(i,frequency,volume) for i,p in enumerate(phones)]
                trials=[]
                for sender in [0,1]:
                    for trial in range(3):
                        before=await phones[1-sender].snapshot();start=len(before['events'])
                        await asyncio.sleep(1.2)
                        baseline=(await phones[1-sender].snapshot())['events'][start:]
                        start+=len(baseline)
                        await phones[sender].js('signalProbe.pilot().then(()=>true)')
                        await asyncio.sleep(.3)
                        observed=(await phones[1-sender].snapshot())['events'][start:]
                        levels=[e for e in observed if e['kind']=='level']
                        signal=percentile([e['amplitude'] for e in levels],.9)
                        noise=percentile([e['amplitude'] for e in baseline if e['kind']=='level'],.95)
                        clipped=max((e['clippedFraction'] for e in levels),default=0)
                        symbols=[e['text'] for e in observed if e['kind']=='symbols']
                        result={'sender':sender,'trial':trial+1,'amplitude':signal,'noiseAmplitude':noise,'marginDb':20*math.log10(max(signal,1e-9)/max(noise,1e-9)),'clippedFraction':clipped,'pilotDecoded':any('VVV' in s for s in symbols),'symbols':symbols}
                        trials.append(result);print(json.dumps({'frequency':frequency,'volume':volume,**result},ensure_ascii=False),flush=True)
                threshold=.0002 if frequency>4000 else .004
                passed=all(sum(t['pilotDecoded'] and t['amplitude']>=threshold and t['marginDb']>=10 and t['clippedFraction']==0 for t in trials if t['sender']==sender)>=2 for sender in [0,1])
                report['measurements'].append({'frequency':frequency,'volume':volume,'candidate':passed,'worstMarginDb':min(t['marginDb'] for t in trials),'deviceInfo':[s['events'][0] for s in info],'trials':trials});save()
                for p in phones:await p.stop()
                if passed:break
        candidates=sorted([m for m in report['measurements'] if m['candidate']],key=lambda m:(m['worstMarginDb'],m['frequency']),reverse=True)[:2]
        report['candidates']=[{'frequency':m['frequency'],'volume':m['volume']} for m in candidates];save()
        print('CANDIDATES '+json.dumps(report['candidates']),flush=True)
    finally:
        for p in phones:
            if hasattr(p,'url'):
                try:await p.stop()
                except Exception as e:report.setdefault('cleanupErrors',[]).append(str(e))
        report['finished']=time.time();save()

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--a',required=True);parser.add_argument('--b',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--frequencies',type=int,nargs='+',default=[18000,19000,20000,21000,22000])
    asyncio.run(run(parser.parse_args()))
