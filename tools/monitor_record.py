#!/usr/bin/env python3
"""Record the Signal Monitor page to video with headless Chromium (Playwright).

Opens http://127.0.0.1:PORT/ in a 1920x1080 context with video recording, takes
full-resolution stills every --still seconds, and stops after --seconds or when
--until-idle sees no new events for --idle seconds. Output: <out>/monitor-*.webm and
<out>/still-NNN.png. Requires: pip install playwright && playwright install chromium.
"""
from __future__ import annotations
import argparse, shutil, sys, time
from pathlib import Path


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', default='http://127.0.0.1:8790/')
    p.add_argument('--out', type=Path, default=Path('test-results/monitor-recording'))
    p.add_argument('--seconds', type=int, default=240)
    p.add_argument('--still', type=int, default=20)
    p.add_argument('--until-idle', action='store_true', help='stop early once the monitor has been idle')
    p.add_argument('--idle', type=int, default=25)
    p.add_argument('--warmup', type=int, default=5, help='seconds to wait before idle detection may stop the recording')
    args = p.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={'width': 1920, 'height': 1080}, record_video_dir=str(args.out), record_video_size={'width': 1920, 'height': 1080}, locale='ja-JP')
        page = ctx.new_page(); page.goto(args.url); page.wait_for_selector('#strip')
        started = time.time(); last_events = -1; last_change = time.time(); n = 0; next_still = 0
        while time.time() - started < args.seconds:
            now = time.time() - started
            if now >= next_still:
                page.screenshot(path=str(args.out / f'still-{n:03d}.png')); n += 1; next_still += args.still
            events = page.evaluate("() => Number(document.getElementById('m-events').textContent)||0")
            busy = page.evaluate("() => document.querySelectorAll('.lane.active').length")
            if events != last_events or busy:
                last_events = events; last_change = time.time()
            if args.until_idle and now > args.warmup and time.time() - last_change > args.idle and events > 0:
                break
            time.sleep(1)
        page.screenshot(path=str(args.out / f'still-{n:03d}.png'))
        video = page.video
        ctx.close(); browser.close()
        path = Path(video.path()) if video else None
        if path and path.exists():
            final = args.out / 'monitor-demo.webm'
            shutil.move(str(path), str(final)); print(f'video: {final}', flush=True)
        print(f'stills: {n + 1}  seconds: {round(time.time() - started)}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
