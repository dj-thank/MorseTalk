"""Shared real Chromium/loopback-server test setup; no mocked HTTP AI responses."""
from contextlib import contextmanager
from pathlib import Path
import os
import shutil
import sys
import threading
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import LocalServer
from playwright.sync_api import sync_playwright
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)

@contextmanager
def served_browser(*, extra_args=()):
    server = LocalServer(0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as p:
            options = dict(headless=True, args=['--no-sandbox', *extra_args])
            executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable:
                options['executable_path'] = executable
            browser = p.chromium.launch(**options)
            try:
                yield server, browser
            finally:
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
