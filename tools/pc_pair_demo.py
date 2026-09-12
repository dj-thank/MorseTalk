#!/usr/bin/env python3
"""Two PC endpoints (headless Chromium) talk through the local relay for a demo.

Uses the desktop AI server (server.py --ai, pointed at a local OpenAI-compatible
Gemma 4 E2B), the loopback relay from tools/pc_android.py (127.0.0.1:8787) and the
Signal Monitor feed (127.0.0.1:8790). Both endpoints run the shipped ai.html: A creates
an invite, B applies it, B waits, A waits, A starts. Nothing leaves the machine.
Requires: pip install playwright && playwright install chromium.
"""
from __future__ import annotations
import argparse, sys, time

SETUP = """([relay, monitor, model, mode, speed, turns, preset, style, maxBytes]) => {
  const $=id=>document.getElementById(id);
  const set=(id,v)=>{const s=$(id);s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}));s.dispatchEvent(new Event('input',{bubbles:true}));};
  $('use-usb').click();set('relay-url',relay);set('dialogue-mode',mode);set('provider','compatible');set('model',model);
  set('speed',String(speed));set('turns',String(turns));set('max-bytes',String(maxBytes));set('preset',preset);set('conversation-style',style);
  $('monitor-enable').checked=Boolean(monitor);if(monitor)$('monitor-url').value=monitor;
  if(!$('consent').checked)$('consent').click();
  return {endpoint:$('endpoint').value,topic:$('topic').value};
}"""
STATE = """() => ({phase:document.getElementById('phase-label').textContent,turns:document.getElementById('turn-count').textContent,
  entries:[...document.querySelectorAll('#transcript .entry.local,#transcript .entry.peer')].map(e=>e.textContent.trim())})"""


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--server', default='http://127.0.0.1:8765')
    p.add_argument('--relay', default='ws://127.0.0.1:8787/v1')
    p.add_argument('--monitor', default='ws://127.0.0.1:8790/feed', help="'' to disable telemetry")
    p.add_argument('--model', default='gemma-4-e2b-it')
    p.add_argument('--mode-a', choices=['ai', 'manual'], default='ai')
    p.add_argument('--mode-b', choices=['ai', 'manual'], default='ai')
    p.add_argument('--speed', type=int, choices=[60, 120, 300, 600, 1200], default=600)
    p.add_argument('--turns', type=int, default=24)
    p.add_argument('--max-bytes', type=int, default=120)
    p.add_argument('--preset', default='daily')
    p.add_argument('--style', default='natural')
    p.add_argument('--topic', default=None)
    p.add_argument('--headed', action='store_true')
    p.add_argument('--timeout', type=int, default=900)
    args = p.parse_args(argv)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed, args=['--autoplay-policy=no-user-gesture-required'])
        pages = []
        for role in (0, 1):
            ctx = browser.new_context(viewport={'width': 1100, 'height': 1400}, locale='ja-JP')
            page = ctx.new_page(); page.goto(f'{args.server}/ai.html'); page.wait_for_selector('#listen'); pages.append(page)
        a, b = pages
        setup = [args.relay, args.monitor, args.model, None, args.speed, args.turns, args.preset, args.style, args.max_bytes]
        info = a.evaluate(SETUP, [*setup[:3], args.mode_a, *setup[4:]])
        b.evaluate(SETUP, [*setup[:3], args.mode_b, *setup[4:]])
        if args.topic:
            a.evaluate("t => {const s=document.getElementById('topic');s.value=t;s.dispatchEvent(new Event('input',{bubbles:true}));}", args.topic)
        print(f"AI endpoint: {info['endpoint']}  topic: {args.topic or info['topic']}", flush=True)
        a.evaluate("() => {document.getElementById('role').value='0';document.getElementById('make-online').click();}")
        a.wait_for_function("() => document.getElementById('invite-text').value.startsWith('MTO1.')")
        invite = a.evaluate("() => document.getElementById('invite-text').value")
        b.evaluate("""inv => {const $=id=>document.getElementById(id);const q=$('qr-input');q.value=inv;q.dispatchEvent(new Event('input',{bubbles:true}));$('qr-stage').click();}""", invite)
        b.wait_for_function("() => !document.getElementById('qr-apply').disabled")
        b.evaluate("""() => {const $=id=>document.getElementById(id);$('qr-apply').click();}""")
        b.wait_for_function("() => document.getElementById('role').value==='1'")
        b.evaluate("""() => {const $=id=>document.getElementById(id);if(!$('network-consent').checked)$('network-consent').click();$('listen').click();}""")
        b.wait_for_function("() => /待|接続中/.test(document.getElementById('phase-label').textContent)", timeout=15000)
        a.evaluate("""() => {const $=id=>document.getElementById(id);if(!$('network-consent').checked)$('network-consent').click();$('listen').click();}""")
        a.wait_for_function("() => !document.getElementById('start').disabled", timeout=30000)
        a.evaluate("() => document.getElementById('start').click()")
        print('conversation started', flush=True)
        seen = 0; started = time.time(); last_phase = ''
        while time.time() - started < args.timeout:
            st = a.evaluate(STATE)
            for line in st['entries'][seen:]:
                print(line, flush=True)
            seen = len(st['entries'])
            if st['phase'] != last_phase:
                last_phase = st['phase']; print(f"[A] {last_phase}", flush=True)
            if '上限' in st['phase'] or '停止' in st['phase'] or '切断' in st['phase'] or '失敗' in st['phase']:
                break
            time.sleep(1.0)
        time.sleep(3)
        for page in pages:
            try:
                page.evaluate("() => document.getElementById('stop').click()")
            except Exception:
                pass
        browser.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
