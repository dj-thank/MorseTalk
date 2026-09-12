#!/usr/bin/env python3
"""Connect two USB-attached Android phones (debug APK) through the local relay.

Prerequisites: the relay from tools/pc_android.py (or `python -m relay.server`)
listening on 127.0.0.1:PORT, both phones authorized for ADB, MorseTalk debug APK
installed on both. Uses WebView remote debugging (debug builds only) to drive the
same buttons a person would tap: USB destination, manual/AI reply mode, invite,
consent, then B waits and A waits. Nothing is sent until a person types.
"""
from __future__ import annotations
import argparse, asyncio, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

PORT = 8787
SDK = os.environ.get('ANDROID_HOME') or str(Path(os.environ.get('LOCALAPPDATA', '')) / 'Android/Sdk')
ADB = os.environ.get('ADB') or str(Path(SDK) / 'platform-tools' / ('adb.exe' if os.name == 'nt' else 'adb'))
PKG = 'jp.morsetalk.app'
JS_HELPERS = """
const $=id=>document.getElementById(id);const w=ms=>new Promise(r=>setTimeout(r,ms));
const set=(id,v)=>{const s=$(id);s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));s.dispatchEvent(new Event('input',{bubbles:true}));};
const run=()=>document.body.innerText.match(/実行状態\\n(.*)/)?.[1]||'';
"""


def adb(serial: str, *args: str, timeout=20) -> str:
    r = subprocess.run([ADB, '-s', serial, *args], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
    if r.returncode:
        raise SystemExit(f'adb {" ".join(args)} failed on {serial}: {r.stderr.strip() or r.stdout.strip()}')
    return r.stdout.strip()


def devices() -> list[str]:
    out = subprocess.run([ADB, 'devices'], capture_output=True, text=True).stdout
    return [l.split()[0] for l in out.splitlines()[1:] if len(l.split()) == 2 and l.split()[1] == 'device']


class Phone:
    def __init__(self, serial: str, local_port: int):
        self.serial, self.local_port = serial, local_port
        self.model = adb(serial, 'shell', 'getprop', 'ro.product.model')

    def prepare(self, relay_port: int):
        adb(self.serial, 'reverse', f'tcp:{relay_port}', f'tcp:{relay_port}')
        adb(self.serial, 'shell', 'am', 'force-stop', PKG)
        adb(self.serial, 'shell', 'am', 'start', '-n', f'{PKG}/.MainActivity')
        for _ in range(30):
            time.sleep(0.5)
            sock = re.search(r'@webview_devtools_remote_(\d+)', adb(self.serial, 'shell', 'cat', '/proc/net/unix'))
            if sock:
                adb(self.serial, 'forward', f'tcp:{self.local_port}', f'localabstract:webview_devtools_remote_{sock.group(1)}')
                break
        else:
            raise SystemExit(f'{self.model}: WebView devtools socket not found (debug build required).')
        for _ in range(30):
            try:
                pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{self.local_port}/json', timeout=2))
                page = [p for p in pages if p['type'] == 'page' and 'ai.html' in p.get('url', '')]
                if page:
                    self.ws = page[0]['webSocketDebuggerUrl']
                    return
            except Exception:
                pass
            time.sleep(0.5)
        raise SystemExit(f'{self.model}: ai.html page not found in WebView.')

    async def js(self, body: str):
        import websockets
        expr = '(async()=>{' + JS_HELPERS + body + '})()'
        async with websockets.connect(self.ws, max_size=None) as ws:
            await ws.send(json.dumps({'id': 1, 'method': 'Runtime.evaluate', 'params': {'expression': expr, 'awaitPromise': True, 'returnByValue': True}}))
            while True:
                m = json.loads(await asyncio.wait_for(ws.recv(), 60))
                if m.get('id') == 1:
                    res = m['result']
                    if 'exceptionDetails' in res:
                        raise SystemExit(f'{self.model}: page script failed: {res["exceptionDetails"].get("text")}')
                    return res.get('result', {}).get('value')


async def pair(a: Phone, b: Phone, mode_a: str, mode_b: str, speed: int, port: int):
    await asyncio.sleep(1.5)  # let the page's own startup finish
    common = f"$('use-usb').click();await w(200);set('relay-url','ws://127.0.0.1:{port}/v1');"
    invite = await a.js(common + f"set('dialogue-mode','{mode_a}');set('role','0');set('speed','{speed}');$('make-online').click();await w(1200);return $('invite-text').value;")
    if not invite or not invite.startswith('MTO1.'):
        raise SystemExit('A could not create an invite.')
    applied = await b.js(common + f"set('dialogue-mode','{mode_b}');const q=$('qr-input');q.value={json.dumps(invite)};q.dispatchEvent(new Event('input',{{bubbles:true}}));$('qr-stage').click();await w(800);$('qr-apply').click();await w(800);if(!$('network-consent').checked)$('network-consent').click();await w(200);$('listen').click();await w(3000);return {{role:$('role').value,run:run()}};")
    if applied['role'] != '1' or '待' not in applied['run']:
        raise SystemExit(f'B did not start waiting: {applied}')
    ready = await a.js("if(!$('network-consent').checked)$('network-consent').click();await w(200);$('listen').click();for(let i=0;i<40;i++){await w(500);if(/確認しました|入力して送信|開始/.test(run()))break;}return run();")
    b_state = await b.js('return run();')
    return ready, b_state


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--a', help='serial of phone A (starts the conversation)')
    p.add_argument('--b', help='serial of phone B (replies)')
    p.add_argument('--mode-a', choices=['manual', 'ai'], default='manual')
    p.add_argument('--mode-b', choices=['manual', 'ai'], default='manual')
    p.add_argument('--speed', type=int, choices=[120, 300, 600, 1200], default=120)
    p.add_argument('--port', type=int, default=PORT)
    args = p.parse_args(argv)
    found = devices()
    a_serial, b_serial = args.a, args.b
    if not (a_serial and b_serial):
        if len(found) != 2:
            raise SystemExit(f'Need exactly two authorized phones or --a/--b. adb devices: {found}')
        a_serial, b_serial = found
    a, b = Phone(a_serial, 9231), Phone(b_serial, 9232)
    print(f'A: {a.model} ({a.serial})\nB: {b.model} ({b.serial})', flush=True)
    a.prepare(args.port); b.prepare(args.port)
    ready, b_state = asyncio.run(pair(a, b, args.mode_a, args.mode_b, args.speed, args.port))
    print(f'A: {ready}\nB: {b_state}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
