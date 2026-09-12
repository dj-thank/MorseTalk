"""Configure two debug APKs for real speaker/microphone Morse communication.

ADB reverse carries model/reading requests only. This helper only operates UI
controls; it never injects PCM, decoded words, model replies, or acknowledgements.
"""
import argparse,asyncio,json,time,urllib.request
from phone_pair import adb,Phone

def prepare(serial,port):
    for remote in (1234,18790):adb(serial,'reverse',f'tcp:{remote}',f'tcp:{remote}')
    adb(serial,'shell','am','start','-n','jp.morsetalk.app/.MainActivity')
    for _ in range(30):
        pid=adb(serial,'shell','pidof','jp.morsetalk.app').split()
        if pid:
            adb(serial,'forward',f'tcp:{port}',f'localabstract:webview_devtools_remote_{pid[0]}')
            try:
                pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json',timeout=2))
                target=next(p for p in pages if '/signal.html' in p.get('url',''))
                phone=Phone(serial,port);phone.ws=target['webSocketDebuggerUrl'];return phone
            except (OSError,StopIteration):pass
        time.sleep(.3)
    raise RuntimeError('Signal画面を開いてください。設定画面では操作できません。')

async def run(args):
    if args.a==args.b:raise ValueError('別々の2台を指定してください')
    phones=[prepare(args.a,19391),prepare(args.b,19392)]
    for role in (1,0):
        phone=phones[role]
        snapshot=await phone.js("return globalThis.morsetalkSignalSnapshot?.();")
        if snapshot and snapshot.get('active'):raise RuntimeError('実行中の会話を先に停止してください')
        body="set('role',"+json.dumps(str(role))+");set('speed',"+json.dumps(str(args.wpm))+");set('topic',"+json.dumps(args.topic)+");"
        if args.start:body+="await $('listen').onclick();"
        print(await phone.js(body+"return document.body.innerText;"),flush=True)
    if args.start:
        states=[await phone.js("return globalThis.morsetalkSignalSnapshot?.();") for phone in phones]
        if not all(s and s.get('active') for s in states):raise RuntimeError('2台のマイク受信を開始できませんでした')
        await phones[0].js("$('start').click();return 'Aから開始';")

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--a',required=True);parser.add_argument('--b',required=True)
    parser.add_argument('--wpm',type=float,default=20)
    parser.add_argument('--topic',default='AIは不確かな時どう行動すべき？')
    parser.add_argument('--start',action='store_true',help='Start both microphones and let A generate the first utterance')
    asyncio.run(run(parser.parse_args()))
