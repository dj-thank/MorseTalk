"""Cancel during PCM reception; no frame may be fabricated or delivered."""
import asyncio,json,argparse
from websockets.asyncio.client import connect

async def main(url):
    async with connect(url+'/view') as view:
        await view.recv()
        async with connect(url+'/conversation',origin=url.replace('ws:','http:')) as owner:
            await owner.send(json.dumps({'kind':'start','consent':True,'topic':'音楽について話そう。','wpm':60,'maxTurns':4}))
            events=[]
            while True:
                e=json.loads(await asyncio.wait_for(view.recv(),10));events.append(e)
                if e.get('kind')=='error':raise RuntimeError(e.get('message'))
                if e.get('kind')=='mark':break
            await owner.send('{"kind":"stop"}')
            while True:
                e=json.loads(await asyncio.wait_for(view.recv(),5));events.append(e)
                if len([item for item in events if item.get('kind')=='feed-close'])==2:break
            assert not any(e.get('kind') in ('frame','delivered') for e in events)
            assert len([e for e in events if e.get('kind')=='stopped'])==2
    async with connect(url+'/view') as check:
        snapshot=json.loads(await check.recv());assert snapshot['roles']==[] and snapshot['feeds']==0
    print('PASS backend cancellation stops both workers before partial PCM can become a frame',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--url',default='ws://127.0.0.1:18791');asyncio.run(main(p.parse_args().url))
