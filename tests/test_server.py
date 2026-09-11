"""Offline transport/security tests; fake ASR is a test double, not a model benchmark."""
import http.client
import io
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import unittest
import wave
import zipfile
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server
from tools.download_model import safe_extract

def wav_bytes(frames=8000, rate=16000, channels=1, width=2):
    out=io.BytesIO()
    with wave.open(out,'wb') as w:
        w.setnchannels(channels); w.setsampwidth(width); w.setframerate(rate); w.writeframes(bytes(frames*channels*width))
    return out.getvalue()

class FakeSpeech:
    def capabilities(self): return {'offlineSpeech': True, 'platform':'test', 'description':'ASR TEST DOUBLE'}
    def transcribe(self, body, language):
        server.validated_pcm(body)
        if language not in ('ja-JP','en-US'): raise ValueError('Unsupported language')
        return 'テスト用の認識結果'

class LocalHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s=server.LocalServer(0,FakeSpeech()); cls.thread=threading.Thread(target=cls.s.serve_forever,daemon=True);cls.thread.start()
    @classmethod
    def tearDownClass(cls): cls.s.shutdown();cls.s.server_close();cls.thread.join()
    def request(self,method,path,body=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.s.server_port,timeout=5)
        c.request(method,path,body=body,headers=headers or {});r=c.getresponse();data=r.read();h=dict(r.getheaders());c.close();return r.status,h,data
    def headers(self): return {'X-MorseTalk-Token':self.s.token,'Origin':self.s.origin,'Content-Type':'audio/wav'}
    def test_root_injects_per_run_token(self):
        code,h,b=self.request('GET','/');self.assertEqual(code,200);self.assertIn(self.s.token.encode(),b);self.assertNotIn(b'__MORSETALK_TOKEN__',b);self.assertEqual(h['Cache-Control'],'no-store');self.assertIn("frame-ancestors 'none'",h['Content-Security-Policy'])
    def test_modules_correct_mime(self):
        for p in ['/js/app.mjs','/core/morse.mjs','/js/rx-worklet.mjs']:
            code,h,_=self.request('GET',p);self.assertEqual(code,200);self.assertIn('javascript',h['Content-Type'])
    def test_static_does_not_expose_source_server(self):
        for p in ['/server.py','/windows/server.ps1','/.git/config','/models/model.bin']:
            self.assertEqual(self.request('GET',p)[0],404)
    def test_traversal_rejected(self):
        for p in ['/../server.py','/%2e%2e/server.py','/..%5cserver.py','/%00','/core/../../server.py']:
            self.assertIn(self.request('GET',p)[0],(400,404))
    def test_dns_rebinding_host(self): self.assertEqual(self.request('GET','/',headers={'Host':'attacker.example'})[0],403)
    def test_cross_site(self): self.assertEqual(self.request('GET','/',headers={'Sec-Fetch-Site':'cross-site'})[0],403)
    def test_api_requires_token(self): self.assertEqual(self.request('GET','/api/capabilities')[0],403)
    def test_capabilities(self):
        status,_,b=self.request('GET','/api/capabilities',headers=self.headers());self.assertEqual(status,200);self.assertTrue(json.loads(b)['offlineSpeech'])
    def test_post_requires_origin(self):
        for origin in (None,'null','https://attacker.example',self.s.origin+'.evil'):
            h=self.headers();h.pop('Origin') if origin is None else h.update(Origin=origin)
            self.assertEqual(self.request('POST','/api/transcribe',wav_bytes(),h)[0],403)
    def test_post_valid_with_test_double(self):
        code,_,b=self.request('POST','/api/transcribe?language=ja-JP',wav_bytes(),self.headers());self.assertEqual(code,200);self.assertEqual(json.loads(b)['text'],'テスト用の認識結果')
    def test_post_wrong_media_type(self):
        h=self.headers();h['Content-Type']='application/octet-stream';self.assertEqual(self.request('POST','/api/transcribe',wav_bytes(),h)[0],415)
    def test_oversized_length_rejected_without_body_read(self):
        h=self.headers();h['Content-Length']='900000';self.assertEqual(self.request('POST','/api/transcribe',b'',h)[0],413)
    def test_short_body_rejected(self): self.assertEqual(self.request('POST','/api/transcribe',b'x',self.headers())[0],413)
    def test_bad_wav(self): self.assertEqual(self.request('POST','/api/transcribe',b'x'*100,self.headers())[0],400)
    def test_bad_language(self): self.assertEqual(self.request('POST','/api/transcribe?language=xx',wav_bytes(),self.headers())[0],400)
    def test_duplicate_host_raw(self):
        with socket.create_connection(('127.0.0.1',self.s.server_port),timeout=5) as sock:
            sock.sendall(f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{self.s.server_port}\r\nHost: attacker.example\r\n\r\n'.encode());self.assertIn(b'403',sock.recv(4096).split(b'\r\n')[0])
    def test_duplicate_token_raw(self):
        with socket.create_connection(('127.0.0.1',self.s.server_port),timeout=5) as sock:
            sock.sendall(f'GET /api/capabilities HTTP/1.1\r\nHost: 127.0.0.1:{self.s.server_port}\r\nX-MorseTalk-Token: {self.s.token}\r\nX-MorseTalk-Token: {self.s.token}\r\n\r\n'.encode());self.assertIn(b'403',sock.recv(4096).split(b'\r\n')[0])
    def test_transfer_encoding_refused(self):
        h=self.headers();h['Transfer-Encoding']='chunked';self.assertEqual(self.request('POST','/api/transcribe',wav_bytes(),h)[0],411)

class AudioValidationTests(unittest.TestCase):
    def test_valid_pcm(self): self.assertEqual(server.validated_pcm(wav_bytes())[1],16000)
    def test_bad_format(self):
        for b in [wav_bytes(channels=2),wav_bytes(rate=44100),wav_bytes(width=1),wav_bytes(frames=1),wav_bytes(frames=337000),b'bad']:
            with self.assertRaises(ValueError): server.validated_pcm(b)
    def test_truncated(self):
        with self.assertRaises(ValueError):server.validated_pcm(wav_bytes()[:-1])

class ModelArchiveTests(unittest.TestCase):
    def check_archive(self, entries, accepted=False):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d);p=folder/'model.zip';dest=folder/'out';dest.mkdir()
            with zipfile.ZipFile(p,'w') as z:
                for name,data in entries:z.writestr(name,data)
            if accepted:safe_extract(p,dest,'expected');self.assertTrue((dest/'expected/am/final.mdl').is_file())
            else:
                with self.assertRaises((ValueError,FileExistsError)):safe_extract(p,dest,'expected')
    def test_good_archive(self):self.check_archive([('expected/am/final.mdl',b'x')],True)
    def test_traversal(self):
        for name in ['../escape','expected/../../escape','/expected/file','expected\\escape','C:/file','wrong/file']:
            self.check_archive([(name,b'x')])
    def test_symlink(self):
        info=zipfile.ZipInfo('expected/link');info.create_system=3;info.external_attr=0o120777<<16;self.check_archive([(info,b'../escape')])
    def test_duplicate_no_overwrite(self):self.check_archive([('expected/x',b'first'),('expected/x',b'second')])

if __name__=='__main__':unittest.main(verbosity=2)
