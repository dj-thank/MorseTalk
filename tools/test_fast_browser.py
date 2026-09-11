#!/usr/bin/env python3
"""Production getUserMedia + AudioWorklet; Chromium fake WAV capture, NOT real hardware."""
import json
import subprocess
from browser_support import ROOT,OUT,served_browser,wait_js
from playwright.sync_api import expect
checks=[]
try:
    for wpm in (120,300,600,1200):
        wav=OUT/f'capture-{wpm}.wav'
        subprocess.run(['node','--input-type=module','-e',f'''
import fs from 'node:fs';
import {{packFastFrame,fastPcm}} from './app/core/fast-codec.mjs';
import {{pcmToWav}} from './app/core/morse.mjs';
const a=fastPcm(packFastFrame({{room:'0000',session:0x20260911,sender:0,seq:1,text:'はい'}}),{{wpm:{wpm}}});
const padded=new Float32Array(a.pcm.length+48000);padded.set(a.pcm,24000);
fs.writeFileSync({json.dumps(str(wav))},new Uint8Array(pcmToWav(padded,a.sampleRate)));
'''],cwd=ROOT,check=True)
        with served_browser(extra_args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',f'--use-file-for-fake-audio-capture={wav}']) as (server,browser):
            page=browser.new_page();errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(server.origin+'/ai.html')
            page.evaluate('''async wpm=>{
              const {FastAudio}=await import('/js/fast-audio.mjs');
              window.frames=[];window.captureErrors=[];
              const button=document.createElement('button');button.id='capture-proof';button.textContent='Start capture';
              button.onclick=async()=>{try{window.engine=new FastAudio({wpm,frequency:4000});window.captureInfo=await engine.start(e=>{if(e.kind==='frame')frames.push(e.frame);if(e.kind==='fatal'||e.kind==='error')captureErrors.push(e);});}catch(e){captureErrors.push(String(e));}};
              document.body.append(button);
            }''',wpm)
            page.locator('#capture-proof').click()
            wait_js(page, '() => frames.length>0 || captureErrors.length>0', timeout_ms=30000)
            data=page.evaluate('({frames,captureErrors,info:captureInfo})')
            assert not data['captureErrors'],data
            assert data['frames'][0]['text']=='はい',data
            stopped=page.evaluate('''async()=>{const tracks=engine.stream.getTracks();engine.stop();await new Promise(r=>setTimeout(r,80));return tracks.every(t=>t.readyState==='ended') && engine.closed && !engine.ctx;}''')
            assert stopped,'Microphone not released'
            assert not errors,errors
            checks.append({'wpm':wpm,'received':data['frames'][0]['text'],'sampleRate':data['info']['sampleRate'],'stopped':stopped})
            print('PASS actual getUserMedia/AudioWorklet',checks[-1],flush=True)
finally:
    (OUT/'fast-browser.json').write_text(json.dumps({'checks':checks,'physical_audio':False,'source':'Chromium fake microphone WAV; production receiver'},ensure_ascii=False,indent=2))
assert len(checks)==4
