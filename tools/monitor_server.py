#!/usr/bin/env python3
"""Loopback demo monitor for MorseTalk.

Serves monitor/ (the visualisation page) and the real codec modules from app/core,
receives telemetry from endpoints on ws://127.0.0.1:PORT/feed, and broadcasts it to
viewers on ws://127.0.0.1:PORT/view. Viewers can ask the optional local Gemma 4 E2B
(OpenAI-compatible endpoint, default LM Studio on 127.0.0.1:1234) for readings and a
sentence guess; the request is forwarded as-is and never leaves the machine unless the
operator points E2B_URL elsewhere. No audio, no cloud, no listener outside loopback.
"""
from __future__ import annotations
import argparse, asyncio, json, mimetypes, os, re, sys, time, urllib.request, shutil, secrets, math
from collections import deque
from http import HTTPStatus
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MONITOR = ROOT / 'monitor'
E2B_URL = os.environ.get('E2B_URL', 'http://127.0.0.1:1234/v1/chat/completions')
E2B_MODEL = os.environ.get('E2B_MODEL', 'gemma-4-e2b-it')
STATIC_ROOTS = {'/': MONITOR, '/monitor/': MONITOR, '/app/core/': ROOT / 'app' / 'core'}
E2B_SYSTEM = (
    'あなたは日本語の読み仮名とローマ字を付ける係です。入力は途中まで受信した文章です。'
    '必ずJSONだけを返します。キー: hiragana（入力全体のひらがな読み。記号はそのまま）, '
    'romaji（同じ読みをヘボン式ローマ字で）, guess（この文がこの後どう続くかの予想を、入力を含めた完全な一文で。20文字以内の追加に留める）。'
    '入力に無い内容を hiragana / romaji に足さないこと。'
)
E2B_SCHEMA = {'type': 'object', 'properties': {'hiragana': {'type': 'string'}, 'romaji': {'type': 'string'}, 'guess': {'type': 'string'}},
              'required': ['hiragana', 'romaji', 'guess'], 'additionalProperties': False}


class Hub:
    def __init__(self, history=600):
        self.viewers: set = set()
        self.feeds: set = set()
        self.feed_roles: dict = {}
        self.stopped: set = set()
        self.history: deque = deque(maxlen=history)
        self.session_headers = {}
        self.e2b_ok = None
        self.e2b_latency = None
        if str(ROOT) not in sys.path:
            sys.path.insert(0, str(ROOT))
        from ai_service import validate_endpoint
        validate_endpoint(E2B_URL, allow_remote=False)
        self.session_owner = None
        self.backend_roles = set()

    async def broadcast(self, text: str):
        event = json.loads(text)
        if event.get('kind')=='session' and event.get('role') in (0,1):self.session_headers[event['role']]=text
        # Keep useful session history even when acoustic marks arrive by the thousand.
        if event.get('kind') in ('session', 'topic-context', 'inference-input', 'agent-awareness', 'model-reply', 'message-display', 'generated', 'tx', 'phonetic-tx', 'frame', 'delivered', 'complete', 'stopped', 'error', 'invalid'):
            self.history.append(text)
        dead = []
        for ws in list(self.viewers):
            try:
                await ws.send(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.viewers.discard(ws)

    def snapshot_history(self):
        history=list(self.history)
        return [text for text in self.session_headers.values() if text not in history]+history

    def roles(self):
        return sorted(({role for roles in self.feed_roles.values() for role in roles} | self.backend_roles) - self.stopped)

    def feed_count(self):
        return len(self.feeds) + len(self.backend_roles)

    def e2b_call(self, text: str) -> dict:
        body = {'model': E2B_MODEL, 'temperature': 0, 'max_tokens': 200,
                'messages': [{'role': 'system', 'content': E2B_SYSTEM}, {'role': 'user', 'content': text}],
                'response_format': {'type': 'json_schema', 'json_schema': {'name': 'reading', 'strict': True, 'schema': E2B_SCHEMA}}}
        req = urllib.request.Request(E2B_URL, data=json.dumps(body).encode('utf-8'), headers={'Content-Type': 'application/json'})
        started = time.monotonic()
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read(1 << 20))
        content = data['choices'][0]['message']['content']
        m = re.search(r'\{.*\}', content, re.S)
        parsed = json.loads(m.group(0)) if m else {}
        if not isinstance(parsed, dict) or not all(isinstance(parsed.get(k), str) for k in ('hiragana', 'romaji', 'guess')) or not parsed['romaji'].strip() or not parsed['hiragana'].strip():
            raise ValueError('Reading response is incomplete')
        self.e2b_latency = round((time.monotonic() - started) * 1000)
        self.e2b_ok = True
        return {'hiragana': str(parsed.get('hiragana', '')), 'romaji': str(parsed.get('romaji', '')), 'guess': str(parsed.get('guess', '')),
                'latencyMs': self.e2b_latency, 'model': data.get('model', E2B_MODEL), 'usage': data.get('usage')}

    async def viewer(self, ws):
        self.viewers.add(ws)
        try:
            await ws.send(json.dumps({'kind': 'monitor', 't': int(time.time() * 1000), 'feeds': self.feed_count(), 'roles': self.roles(), 'e2b': self.e2b_ok, 'e2bModel': E2B_MODEL, 'history': self.snapshot_history()}))
            async for raw in ws:
                if not isinstance(raw, str) or len(raw) > 4000:
                    continue
                try:
                    msg = json.loads(raw)
                except ValueError:
                    continue
                if msg.get('kind') == 'e2b' and isinstance(msg.get('text'), str) and 0 < len(msg['text']) <= 600:
                    rid = msg.get('id')
                    try:
                        result = await asyncio.get_running_loop().run_in_executor(None, self.e2b_call, msg['text'])
                        response = {'kind': 'e2b-result', 'id': rid, 'text': msg['text'], **result}
                    except Exception as exc:  # local model unavailable: the page falls back to its own kana table
                        self.e2b_ok = False
                        response = {'kind': 'e2b-result', 'id': rid, 'text': msg['text'], 'error': type(exc).__name__}
                    from websockets.exceptions import ConnectionClosed
                    try:
                        await ws.send(json.dumps(response))
                    except ConnectionClosed:
                        break  # A viewer closing isn't a model failure.
                elif msg.get('kind') == 'inject' and isinstance(msg.get('event'), dict):
                    # Demo replay generated by the page itself is echoed to every viewer.
                    event = msg['event']; event['t'] = int(time.time() * 1000); event['demo'] = True
                    await self.broadcast(json.dumps(event))
        finally:
            self.viewers.discard(ws)

    async def feed(self, ws):
        self.feeds.add(ws)
        self.feed_roles[ws] = set()
        try:
            await self.broadcast(json.dumps({'kind': 'feed-open', 't': int(time.time() * 1000), 'feeds': len(self.feeds)}))
            async for raw in ws:
                if isinstance(raw, str) and len(raw) <= 20000:
                    try:
                        event = json.loads(raw)
                    except ValueError:
                        continue
                    if not isinstance(event, dict) or event.get('role') not in (0, 1):
                        continue
                    role = event['role']
                    self.feed_roles[ws].add(role)
                    if event.get('kind') == 'session':
                        self.stopped.discard(role)
                    elif event.get('kind') == 'stopped':
                        self.stopped.add(role)
                    await self.broadcast(raw)
        finally:
            self.feeds.discard(ws)
            roles = self.feed_roles.pop(ws, set())
            for role in roles:
                await self.broadcast(json.dumps({'kind': 'feed-close', 'role': role, 'roles': self.roles(), 't': int(time.time() * 1000), 'feeds': len(self.feeds)}))

    async def handler(self, ws):
        path = ws.request.path
        if path == '/reading':
            async for raw in ws:
                if not isinstance(raw,str) or len(raw)>4000:continue
                request=json.loads(raw)
                if not isinstance(request,dict):continue
                if not isinstance(request.get('text'),str) or not 0<len(request['text'])<=600:
                    await ws.send(json.dumps({'id':request.get('id'),'result':{'error':'Reading text must contain 1-600 characters'}}));continue
                process=await asyncio.create_subprocess_exec(os.environ.get('MORSETALK_READING_PYTHON',sys.executable),'-X','utf8',str(ROOT/'tools/japanese_reading.py'),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL)
                try:
                    body=json.dumps({'text':request['text'],'mode':'format' if request.get('mode')=='format' else 'reading'}).encode('utf-8')
                    output,_=await asyncio.wait_for(process.communicate(body),5)
                    await ws.send(json.dumps({'id':request.get('id'),'result':json.loads(output)}))
                finally:
                    if process.returncode is None:process.kill();await process.wait()
        elif path == '/feed':
            await self.feed(ws)
        elif path == '/view':
            await self.viewer(ws)
        elif path == '/conversation':
            await self.conversation(ws)
        else:
            await ws.close(1008, 'unknown path')

    async def conversation(self, ws):
        from websockets.exceptions import ConnectionClosed
        process = None
        try:
            raw = await asyncio.wait_for(ws.recv(), 10)
            request = json.loads(raw)
            if not isinstance(request, dict) or request.get('kind') != 'start' or request.get('consent') is not True:
                raise ValueError('会話開始の入力が不正です。')
            topic = request.get('topic', '')
            if not isinstance(topic, str) or not topic.strip() or len(topic.encode('utf-8')) > 69:
                raise ValueError('話題は短い一文で入力してください。')
            wpm = request.get('wpm', 60)
            turns = request.get('maxTurns', 0)
            language=request.get('language','ja')
            if isinstance(wpm,bool) or not isinstance(wpm,(int,float)) or not math.isfinite(wpm) or wpm<=0 or isinstance(turns,bool) or turns not in (0, 4, 6) or language not in ('ja','en'):
                raise ValueError('速度とターン数を確認してください。')
            if self.session_owner or self.feeds:
                raise ValueError('別の会話が進行中です。')
            node = shutil.which('node.exe') or shutil.which('node')
            if not node:
                raise ValueError('Node.jsを利用できません。')
            self.session_owner = ws
            process = await asyncio.create_subprocess_exec(node, str(ROOT/'tools/signal_session.mjs'), cwd=ROOT,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
            command = {'kind':'start','topic':topic,'wpm':wpm,'maxTurns':turns,'language':language,'session':secrets.randbits(32),'model':E2B_MODEL,'endpoint':E2B_URL,'readingPython':os.environ.get('MORSETALK_READING_PYTHON',sys.executable)}
            process.stdin.write((json.dumps(command)+'\n').encode('utf-8'));await process.stdin.drain()

            async def events():
                ended = False
                while line := await process.stdout.readline():
                    event = json.loads(line)
                    if event.get('kind') == 'session-ended':
                        ended = True
                        await ws.send(json.dumps(event))
                        return
                    role = event.get('role')
                    if event.get('kind') == 'session':
                        self.backend_roles.add(role);self.stopped.discard(role)
                        await self.broadcast(json.dumps({'kind':'feed-open','feeds':self.feed_count()}))
                    if event.get('kind') == 'stopped':
                        self.stopped.add(role)
                    await self.broadcast(json.dumps(event,ensure_ascii=False))
                if not ended:
                    raise RuntimeError('会話プロセスが終了しました。')

            async def controls():
                async for raw in ws:
                    if len(raw) <= 1000 and json.loads(raw).get('kind') == 'stop':
                        process.stdin.write(b'{"kind":"stop"}\n');await process.stdin.drain()
                        return

            tasks=[asyncio.create_task(events()),asyncio.create_task(controls())]
            try:
                done,pending=await asyncio.wait(tasks,timeout=None if turns==0 else 900,return_when=asyncio.FIRST_COMPLETED)
                for task in done:task.result()
            finally:
                for task in tasks:
                    if not task.done():task.cancel()
                await asyncio.gather(*tasks,return_exceptions=True)
        except ConnectionClosed:
            pass
        except Exception as exc:
            try:await ws.send(json.dumps({'kind':'session-ended','error':str(exc)}))
            except ConnectionClosed:pass
        finally:
            if process and process.returncode is None:
                process.terminate()
                await process.wait()
            if self.session_owner is ws:
                roles=list(self.backend_roles);self.backend_roles.clear();self.session_owner=None
                for role in roles:
                    if role not in self.stopped:
                        self.stopped.add(role)
                        await self.broadcast(json.dumps({'kind':'stopped','role':role}))
                    await self.broadcast(json.dumps({'kind':'feed-close','role':role,'roles':self.roles(),'feeds':self.feed_count()}))

def static_response(connection, request):
    from websockets.http11 import Response
    from websockets.datastructures import Headers
    path = request.path.split('?', 1)[0]
    if path == '/reading':
        origin=request.headers.get('Origin','')
        if origin not in ('https://appassets.androidplatform.net','http://'+request.headers.get('Host','')):
            return Response(403,'Forbidden',Headers(),b'Forbidden')
        return None
    if path == '/conversation':
        from urllib.parse import urlsplit
        origin = urlsplit(request.headers.get('Origin', ''))
        if origin.scheme != 'http' or origin.hostname not in ('127.0.0.1', 'localhost') or origin.netloc != request.headers.get('Host'):
            body = b'Open the local application to start a conversation.\n'
            return Response(403, 'Forbidden', Headers([('Content-Type', 'text/plain'), ('Content-Length', str(len(body)))]), body)
    if path in ('/feed', '/view', '/conversation'):
        return None
    if path == '/':
        path = '/monitor/index.html'
    for prefix, root in STATIC_ROOTS.items():
        if prefix != '/' and path.startswith(prefix):
            rel = path[len(prefix):]
            if not re.fullmatch(r'[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*', rel) or '..' in rel:
                break
            target = (root / rel).resolve()
            if root.resolve() in target.parents and target.is_file():
                ctype = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
                if target.suffix == '.mjs':
                    ctype = 'text/javascript'
                body = target.read_bytes()
                return Response(200, 'OK', Headers([('Content-Type', f'{ctype}; charset=utf-8' if ctype.startswith('text') else ctype),
                                                    ('Content-Length', str(len(body))), ('Cache-Control', 'no-store')]), body)
            break
    body = b'Not found\n'
    return Response(404, 'Not Found', Headers([('Content-Type', 'text/plain'), ('Content-Length', str(len(body)))]), body)


async def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8790)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--restore-history', type=Path, help='Restore an exported local monitor snapshot as offline history')
    args = parser.parse_args(argv)
    from websockets.asyncio.server import serve
    hub = Hub()
    if args.restore_history and args.restore_history.is_file():
        snapshot=json.loads(args.restore_history.read_text(encoding='utf-8'))
        for event in snapshot.get('history',[]):
            if isinstance(event,str) and isinstance(json.loads(event),dict):await hub.broadcast(event)
    async with serve(hub.handler, '127.0.0.1', args.port, process_request=static_response, max_size=1 << 20, compression=None) as server:
        print(f'監視画面: http://127.0.0.1:{args.port}/', flush=True)
        print(f'端末側の監視先: ws://127.0.0.1:{args.port}/feed（adb reverse tcp:{args.port} tcp:{args.port} が必要）', flush=True)
        print(f'E2B: {E2B_URL} model={E2B_MODEL}（無ければ内蔵かな表で表示）', flush=True)
        if not args.no_browser:
            import webbrowser
            webbrowser.open(f'http://127.0.0.1:{args.port}/')
        await server.serve_forever()
    return 0


if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        pass
