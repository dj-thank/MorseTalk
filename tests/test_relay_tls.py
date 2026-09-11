"""Actual WSS with an ephemeral test CA; certificate verification remains enabled.
This is loopback TLS, not a deployed public relay or physical phones.
"""
import asyncio
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import unittest
from websockets.asyncio.server import serve
from websockets.asyncio.client import connect
from relay.server import Relay, process_request, LOCAL_ORIGIN

ROOT = Path(__file__).resolve().parents[1]

class RelayTlsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        folder = Path(self.temp.name)
        self.cert, key = folder/'test-cert.pem', folder/'test-key.pem'
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1',
                        '-keyout',str(key),'-out',str(self.cert),'-subj','/CN=localhost',
                        '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],
                       check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(self.cert,key)
        self.relay = Relay()
        # None is test-only for Node's WebSocket API, not allowed by the deployed relay.
        self.server = await serve(self.relay.handler,'127.0.0.1',0,ssl=context,
                                  origins=[None,LOCAL_ORIGIN],process_request=process_request,
                                  max_size=11000,compression=None,close_timeout=1)
        self.url = f'wss://127.0.0.1:{self.server.sockets[0].getsockname()[1]}/v1'
    async def asyncTearDown(self):
        self.server.close();await self.server.wait_closed();self.temp.cleanup()
    async def test_untrusted_certificate_rejected(self):
        with self.assertRaises(ssl.SSLCertVerificationError):
            async with connect(self.url,ssl=ssl.create_default_context()):
                self.fail('Untrusted test certificate must never be accepted')
    async def test_real_js_clients_over_verified_wss(self):
        env = {**os.environ,'NODE_EXTRA_CA_CERTS':str(self.cert)}
        process = await asyncio.create_subprocess_exec('node','tools/test_online_wire.mjs',self.url,
                    cwd=ROOT,env=env,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        try:out,err = await asyncio.wait_for(process.communicate(),25)
        except BaseException:process.kill();await process.wait();raise
        self.assertEqual(process.returncode,0,(out+err).decode())
        self.assertTrue(json.loads(out)['ok'])

if __name__=='__main__':unittest.main()
