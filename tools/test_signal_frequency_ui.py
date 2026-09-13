"""Bundled Signal UI with a browser-provided fake microphone, no physical-audio claim."""
import asyncio,os,threading
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        path=urlsplit(path).path.lstrip('/')
        file=((ROOT/path) if path.startswith(('monitor/','app/')) else (ROOT/'app'/path)).resolve()
        return str(file if file.is_relative_to(ROOT) else ROOT/'missing-test-resource')
    def log_message(self,*args):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(**({'channel':'msedge'} if os.name=='nt' else {}),headless=True,args=['--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--unsafely-treat-insecure-origin-as-secure=http://signal.test'])
        page=await browser.new_page(viewport={'width':412,'height':915});errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        await page.route_web_socket('ws://127.0.0.1:18790/reading',lambda ws:None)
        await page.goto(origin+'/signal.html');await page.wait_for_function('typeof morsetalkSignalSnapshot==="function"')
        assert await page.locator('#frequency').input_value()=='1800'
        assert await page.locator('#frequency option').count()==6
        await page.locator('#frequency').select_option('19000');await page.locator('#listen').click()
        await page.wait_for_function('document.querySelector("#frequency").disabled || !document.querySelector("#error").hidden')
        assert await page.locator('#frequency').is_disabled(),await page.locator('#error').text_content()
        ready=await page.evaluate('morsetalkSignalSnapshot().events.find(e=>e.kind==="ready")')
        assert ready['frequency']==19000 and ready['sampleRate']==48000
        assert not await page.evaluate('document.documentElement.scrollWidth>innerWidth')
        await page.locator('#stop').click();assert await page.locator('#frequency').is_enabled()
        await page.reload();await page.wait_for_function('typeof morsetalkSignalSnapshot==="function"')
        assert await page.locator('#frequency').input_value()=='19000'
        await page.locator('#frequency').select_option('1800');await page.locator('#listen').click()
        await page.wait_for_function('document.querySelector("#frequency").disabled')
        await page.evaluate('dispatchEvent(new Event("morsetalk-native-pause"))')
        assert await page.locator('#frequency').is_enabled()
        assert not await page.evaluate('morsetalkSignalSnapshot().active')
        assert not errors,errors
        print('PASS: default, choices, actual worklet startup, setting lock, persistence, stop/background, viewport (fake microphone)')
        await browser.close()
try:asyncio.run(main())
finally:server.shutdown();server.server_close()
