"""Verify two actual browser endpoints and monitor using the configured real LLM.

No response fixtures. The output records endpoint AI requests, emitted telemetry,
decoded text, ACKs and monitor screenshots. Uses a dedicated local relay/session.
"""
import argparse,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright
from pc_pair_demo import SETUP,STATE

p=argparse.ArgumentParser();p.add_argument('--server',default='http://127.0.0.1:18765');p.add_argument('--relay',default='ws://127.0.0.1:18787/v1');p.add_argument('--monitor',default='http://127.0.0.1:18790');p.add_argument('--out',required=True);p.add_argument('--turns',type=int,default=6);args=p.parse_args()
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
result={'model':'gemma-4-e2b-it','transport':'encrypted-online-morse','physicalAudio':False,'separateModels':False,'requests':[],'checks':[]}
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True,args=['--autoplay-policy=no-user-gesture-required'])
    monitor=browser.new_page(viewport={'width':1440,'height':1100});errors=[]
    monitor.on('pageerror',lambda e:errors.append(str(e)))
    monitor.add_init_script("""window.events=[];const Native=WebSocket;window.WebSocket=class extends Native{constructor(...args){super(...args);this.addEventListener('message',e=>{try{let m=JSON.parse(e.data);if(m.kind!=='monitor')window.events.push(m);}catch{}})}};""")
    monitor.goto(args.monitor);monitor.wait_for_function("()=>document.getElementById('chip-hub').classList.contains('on')");monitor.locator('#clear').click()
    pages=[]
    for role in (0,1):
        ctx=browser.new_context(viewport={'width':1100,'height':1000},locale='ja-JP');page=ctx.new_page();pages.append(page)
        page.on('pageerror',lambda e:errors.append(str(e)))
        def capture(req,role=role):
            if req.url.endswith('/api/ai/chat') and req.method=='POST':
                result['requests'].append({'role':role,**req.post_data_json})
        page.on('request',capture)
        page.goto(args.server+'/ai.html');page.wait_for_selector('#listen')
        page.evaluate(SETUP,[args.relay,args.monitor.replace('http:','ws:')+'/feed','gemma-4-e2b-it','ai',600,args.turns,'food','natural',120])
    a,b=pages
    a.evaluate("()=>{document.getElementById('role').value='0';document.getElementById('make-online').click()}")
    a.wait_for_function("()=>document.getElementById('invite-text').value.startsWith('MTO1.')")
    invite=a.locator('#invite-text').input_value()
    b.evaluate("inv=>{let e=document.getElementById('qr-input');e.value=inv;e.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('qr-stage').click()}",invite)
    b.wait_for_function("()=>!document.getElementById('qr-apply').disabled");b.locator('#qr-apply').click()
    for page in (b,a):
        page.evaluate("()=>{let c=document.getElementById('network-consent');if(!c.checked)c.click();document.getElementById('listen').click()}")
    a.wait_for_function("()=>!document.getElementById('start').disabled",timeout=30000);a.locator('#start').click()
    print('Real Gemma conversation started',flush=True)
    started=time.monotonic();captured=False
    while time.monotonic()-started<180:
        events=monitor.evaluate('events');generated=[e for e in events if e.get('kind')=='generated']
        if len(generated)>=3 and not captured:
            monitor.screenshot(path=str(out/'monitor-live.png'),full_page=True);captured=True
        if len([e for e in events if e.get('kind')=='delivered'])>=args.turns:break
        if any(e.get('kind')=='error' for e in events):break
        monitor.wait_for_timeout(150)
    monitor.wait_for_timeout(2500)
    monitor.wait_for_function("()=>events.some(e=>e.kind==='e2b-result'&&!e.error)",timeout=30000)
    # The reader is an independent request after CRC validation. Wait for the
    # current text's reading, not just completion of the endpoint conversation.
    monitor.wait_for_function("()=>[0,1].every(r=>document.getElementById('romaji-'+r).textContent&&!/[一-龯]/.test(document.getElementById('romaji-'+r).textContent))",timeout=30000)
    events=monitor.evaluate('events');result['events']=events;result['seconds']=round(time.monotonic()-started,2)
    result['endpointStates']=[page.evaluate(STATE) for page in pages]
    result['monitor']={'input':[monitor.locator(f'#input-{r}').inner_text() for r in (0,1)],'output':[monitor.locator(f'#output-{r}').inner_text() for r in (0,1)],'text':[monitor.locator(f'#text-{r}').inner_text() for r in (0,1)],'logTurns':monitor.locator('#log .msg.a,#log .msg.b').count()}
    monitor.screenshot(path=str(out/'monitor-desktop.png'),full_page=True)
    monitor.set_viewport_size({'width':390,'height':844});monitor.screenshot(path=str(out/'monitor-mobile.png'),full_page=True)
    for page in pages:
        page.evaluate("document.getElementById('stop').click()")
    monitor.wait_for_timeout(250)
    result['stoppedChips']=[monitor.locator(f'#chip-{r}').get_attribute('class') for r in ('a','b')]
    result['errors']=errors
    try:
        data=[e for e in events if e.get('kind')=='tx' and e.get('type')=='data']
        frames=[e for e in events if e.get('kind')=='frame' and e.get('frame',{}).get('type')=='data']
        delivered=[e for e in events if e.get('kind')=='delivered']
        generated=[e for e in events if e.get('kind')=='generated' and e.get('origin')=='ai']
        assert len(data)==len(frames)==len(delivered)==args.turns,(len(data),len(frames),len(delivered))
        assert len(generated)==args.turns-1
        for tx in data:
            rx=next(e for e in frames if e['frame']['seq']==tx['seq'])
            assert tx['text']==rx['frame']['text'] and rx['role']==1-tx['role']
        result['checks'].append('All transmitted turns exactly match peer-decoded frames and delivery ACKs')
        inputs=[e for e in events if e.get('kind')=='inference-input']
        assert len(inputs)==len(result['requests'])
        for event,request in zip(inputs,result['requests']):
            assert event['role']==request['role']
            assert event['messageCount']==len(request['messages'])
            assert event['input'] in [m['content'] for m in request['messages'] if m['role']=='user']
            assert event['inputBytes']==len('\n'.join(m['content'] for m in request['messages']).encode('utf-8'))
        result['checks'].append('Displayed inference telemetry agrees with actual AI POST input and byte count')
        assert result['monitor']['logTurns']==args.turns
        assert all('on' not in c.split() for c in result['stoppedChips'])
        assert not errors,errors
        result['checks'].append('Monitor shows one entry per turn, both endpoints, and stopped connections')
        readings=[e for e in events if e.get('kind')=='e2b-result' and not e.get('error')]
        assert readings,'No successful real Gemma reading observed'
        result['checks'].append('Real Gemma reading responses received by monitor')
        result['status']='PASS'
        print(json.dumps({'status':'PASS','turns':len(data),'inferences':len(generated),'readings':len(readings),'seconds':result['seconds']},ensure_ascii=False),flush=True)
    except Exception as exc:
        result['status']='FAIL';result['failure']=repr(exc);raise
    finally:
        (out/'real-gemma-monitor.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        browser.close()
