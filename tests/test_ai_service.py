"""Actual loopback HTTP contract tests with explicitly simulated model responses, not LLM inference."""
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sys
import threading
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai_service import AIService, validate_endpoint, validate_chat
import server
class ModelStub(BaseHTTPRequestHandler):
    payloads = []
    def log_message(self,*args): pass
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.payloads.append(data)
        if self.path == '/redirect':
            self.send_response(302); self.send_header('Location','http://192.0.2.1/private'); self.end_headers(); return
        if self.path == '/huge': body=b'x'*131073
        elif self.path == '/tools': body=json.dumps({'message':{'tool_calls':[{'name':'unsafe'}]}}).encode()
        elif self.path == '/bad': body=b'not JSON'
        elif self.path == '/v1/chat/completions': body=json.dumps({'choices':[{'message':{'content':'stub compatible reply'}}]}).encode()
        else: body=json.dumps({'message':{'content':'これはテスト用の応答です。'}},ensure_ascii=False).encode()
        self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers();self.wfile.write(body)
class AIServiceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s=ThreadingHTTPServer(('127.0.0.1',0),ModelStub);cls.t=threading.Thread(target=cls.s.serve_forever,daemon=True);cls.t.start();cls.url=f'http://127.0.0.1:{cls.s.server_port}'
    @classmethod
    def tearDownClass(cls): cls.s.shutdown();cls.s.server_close();cls.t.join()
    def payload(self): return {'consent':True,'model':'test-stub','messages':[{'role':'system','content':'短く返答'},{'role':'user','content':'会話'}]}
    def test_ollama_contract(self):
        ai=AIService(endpoint=self.url+'/api/chat');r=ai.chat(self.payload());self.assertEqual(r['text'],'これはテスト用の応答です。');p=ModelStub.payloads[-1];self.assertFalse(p['stream']);self.assertFalse(p['think']);self.assertNotIn('tools',p);self.assertEqual(p['keep_alive'],'10m')
    def test_compatible_contract(self): self.assertEqual(AIService(endpoint=self.url+'/v1/chat/completions',provider='compatible').chat(self.payload())['text'],'stub compatible reply')
    def test_redirect_rejected(self):
        with self.assertRaises(ValueError): AIService(endpoint=self.url+'/redirect').chat(self.payload())
    def test_oversized_response_rejected(self):
        with self.assertRaises(ValueError): AIService(endpoint=self.url+'/huge').chat(self.payload())
    def test_tool_only_reply_not_executed(self):
        with self.assertRaises(ValueError): AIService(endpoint=self.url+'/tools').chat(self.payload())
    def test_bad_response_rejected(self):
        with self.assertRaises(ValueError): AIService(endpoint=self.url+'/bad').chat(self.payload())
    def test_concurrency_bounded(self):
        ai=AIService(endpoint=self.url+'/api/chat');ai.lock.acquire()
        try:
            with self.assertRaises(BlockingIOError): ai.chat(self.payload())
        finally: ai.lock.release()
    def test_no_default_cloud_or_redirect_proxy(self):
        self.assertEqual(validate_endpoint('http://127.0.0.1:11434/api/chat')[1],False)
        for url in ['https://example.com/chat','http://192.168.1.1/chat','http://localhost:1/chat','file:///etc/passwd','http://user:pass@127.0.0.1/chat','http://127.0.0.1:0/chat','http://127.0.0.1/chat?q=x','http://127.0.0.1/chat#secret']:
            with self.subTest(url=url),self.assertRaises(ValueError):validate_endpoint(url)
        self.assertEqual(validate_endpoint('https://example.com/chat',True)[1],True)
        with self.assertRaises(ValueError):validate_endpoint('http://example.com/chat',True)
    def test_chat_consent_and_roles(self):
        for change in [{'consent':False},{'messages':[]},{'messages':[{'role':'tool','content':'x'}]},{'messages':[{'role':'user','content':'x'},{'role':'system','content':'y'}]},{'model':'bad\nname'},{'messages':[{'role':'user','content':'x'*8001}]}]:
            with self.assertRaises(ValueError):validate_chat({**self.payload(),**change})
    def test_model_name_required(self):
        p=self.payload();p['model']=''
        with self.assertRaises(ValueError):AIService(endpoint=self.url+'/api/chat',model='').chat(p)
    def test_actual_morsetalk_http_ai_route(self):
        app=server.LocalServer(0);app.ai=AIService(endpoint=self.url+'/api/chat');t=threading.Thread(target=app.serve_forever,daemon=True);t.start()
        try:
            def call(method,path,body=None,headers=None):
                c=http.client.HTTPConnection('127.0.0.1',app.server_port,timeout=5);c.request(method,path,body=body,headers=headers or {});r=c.getresponse();b=r.read();code=r.status;c.close();return code,b
            h={'X-MorseTalk-Token':app.token,'Origin':app.origin,'Content-Type':'application/json'}
            code,body=call('GET','/ai.html');self.assertEqual(code,200);self.assertIn(app.token.encode(),body)
            self.assertEqual(call('GET','/api/ai/capabilities')[0],403)
            self.assertEqual(call('POST','/api/ai/chat',json.dumps(self.payload()),h)[0],200)
            self.assertEqual(call('POST','/api/ai/chat','{}',h)[0],400)
            self.assertEqual(call('POST','/api/ai/chat','{}',{**h,'Origin':'https://evil.example'})[0],403)
        finally: app.shutdown();app.server_close();t.join()
if __name__=='__main__':unittest.main(verbosity=2)
