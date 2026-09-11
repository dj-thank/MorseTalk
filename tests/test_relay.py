"""Actual loopback WebSocket service tests; no public server, no physical devices."""
import asyncio
import json
from pathlib import Path
import secrets
import sys
import time
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from relay.server import Relay, process_request, LOCAL_ORIGIN
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

class RelayTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.relay=Relay();self.server=await serve(self.relay.handler,'127.0.0.1',0,origins=['https://appassets.androidplatform.net',LOCAL_ORIGIN,None],max_size=11000,compression=None,process_request=process_request,close_timeout=1)
        self.url=f'ws://127.0.0.1:{self.server.sockets[0].getsockname()[1]}/v1';self.sockets=[]
        self.join={'t':'join','v':1,'room':secrets.token_urlsafe(16),'auth':secrets.token_urlsafe(32),'side':0,'expires':int(time.time()*1000)+30000}
    async def asyncTearDown(self):
        for s in self.sockets:await s.close()
        self.server.close();await self.server.wait_closed()
    async def socket(self, **opts):
        s=await connect(self.url,**opts);self.sockets.append(s);return s
    async def joined(self, **changes):
        s=await self.socket();await s.send(json.dumps({**self.join,**changes}));return s
    async def receive(self,s):return json.loads(await asyncio.wait_for(s.recv(),3))
    async def test_actual_js_clients_four_turns(self):
        # Origin=None allowed only in THIS loopback test to exercise Node's browser-like WebSocket API.
        process=await asyncio.create_subprocess_exec('node','tools/test_online_wire.mjs',self.url,cwd=ROOT,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        try:out,err=await asyncio.wait_for(process.communicate(),20)
        except BaseException:process.kill();await process.wait();raise
        self.assertEqual(process.returncode,0,(out+err).decode());self.assertTrue(json.loads(out)['ok'])
    async def test_two_slots_relay_ciphertext_and_disconnect(self):
        a=await self.joined();self.assertEqual((await self.receive(a))['t'],'waiting')
        b=await self.joined(side=1);self.assertEqual((await self.receive(a))['t'],'paired');self.assertEqual((await self.receive(b))['t'],'paired')
        box={'t':'box','from':0,'iv':'a'*16,'body':'a'*32};await a.send(json.dumps(box));self.assertEqual(await self.receive(b),box)
        await a.close();await asyncio.wait_for(b.wait_closed(),3)
    async def test_wrong_auth_never_evicts_owner(self):
        a=await self.joined();await self.receive(a)
        bad=await self.joined(side=1,auth=secrets.token_urlsafe(32));self.assertEqual((await self.receive(bad))['t'],'error')
        b=await self.joined(side=1);self.assertEqual((await self.receive(b))['t'],'paired')
    async def test_occupied_role_rejected(self):
        a=await self.joined();await self.receive(a);bad=await self.joined();self.assertEqual((await self.receive(bad))['code'],'occupied-or-expired')
    async def test_third_device_rejected(self):
        a=await self.joined();await self.receive(a);b=await self.joined(side=1);await self.receive(a);await self.receive(b)
        c=await self.joined(side=1);self.assertEqual((await self.receive(c))['t'],'error')
    async def test_disconnected_invitation_cannot_be_reused(self):
        a=await self.joined();await self.receive(a);await a.close();await asyncio.sleep(.02)
        b=await self.joined(side=1);self.assertEqual((await self.receive(b))['t'],'error')
    async def test_expired_invitation_rejected(self):
        a=await self.joined(expires=int(time.time()*1000)-1);self.assertEqual((await self.receive(a))['t'],'error')
    async def test_plaintext_not_forwarded(self):
        a=await self.joined();await self.receive(a);b=await self.joined(side=1);await self.receive(a);await self.receive(b)
        await a.send(json.dumps({'t':'chat','text':'secret'}));self.assertEqual((await self.receive(a))['t'],'error');await asyncio.wait_for(b.wait_closed(),3)
    async def test_unknown_origin_rejected(self):
        with self.assertRaises(InvalidStatus):await self.socket(origin='https://evil.example')
    async def test_allowed_app_origin(self):
        a=await self.socket(origin='https://appassets.androidplatform.net');await a.send(json.dumps(self.join));self.assertEqual((await self.receive(a))['t'],'waiting')
    async def test_query_parameters_not_accepted(self):
        with self.assertRaises(InvalidStatus):await connect(self.url+'?secret=must-not-be-here')
    async def test_capacity_and_expiry_cleanup_bounded(self):
        self.relay.max_rooms=1;a=await self.joined();await self.receive(a)
        b=await self.joined(room=secrets.token_urlsafe(16));self.assertEqual((await self.receive(b))['code'],'capacity')
        await a.close();await asyncio.sleep(.02);self.relay.rooms[self.join['room']].expires=0;self.relay.sweep();self.assertEqual(len(self.relay.rooms),0)

if __name__=='__main__':unittest.main()
