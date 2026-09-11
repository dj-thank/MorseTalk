"""Shared real Chromium/loopback-server test setup; no mocked HTTP AI responses."""
from contextlib import contextmanager
from pathlib import Path
import os
import shutil
import sys
import threading
import time
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


def wait_js(page, predicate: str, *, timeout_ms: int = 30000) -> None:
    """Poll via the automation protocol without injecting eval into the CSP page.

    The production CSP remains intact. Unlike wait_for_function, this helper
    does not construct a function with eval in the page execution environment.
    """
    deadline = time.monotonic() + timeout_ms / 1000
    while not page.evaluate(predicate):
        if time.monotonic() >= deadline:
            raise TimeoutError(f'Browser predicate did not succeed in {timeout_ms} ms: {predicate}')
        page.wait_for_timeout(50)
