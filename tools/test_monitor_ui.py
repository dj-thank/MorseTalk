"""Signal Monitor regressions over the real loopback WebSocket hub.

Telemetry in these tests is explicitly synthetic. No LLM or physical audio claim.
Run against an owned monitor_server.py --port 18790 instance.
"""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect

p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:18790');p.add_argument('--case',default='all');args=p.parse_args()
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',args=['--mute-audio'])
    page=browser.new_page(viewport={'width':1440,'height':1100});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(args.url);page.wait_for_function("document.getElementById('chip-hub').classList.contains('on')")
    feed_script="""async()=>{
      window.feed=new WebSocket(`ws://${location.host}/feed`);
      await new Promise(r=>feed.onopen=r);
      window.emit=e=>feed.send(JSON.stringify({t:Date.now(),role:0,...e}));
      window.frameFor=async(text,seq=1)=>{
        const c=await import('/app/core/fast-codec.mjs');const m=await import('/app/core/morse.mjs');
        const b=c.packFastFrame({text,room:'0000',session:123,sender:0,seq});
        const wire=c.fastWire(b);
        return {bytes:Array.from(b),wire,morse:[...wire].map(c=>m.INTERNATIONAL[c]).join(' '),frame:c.unpackFastFrame(b)};
      };
    }"""
    page.evaluate(feed_script)
    def emit(e):page.evaluate('e=>emit(e)',e)
    def clear():
        if page.locator('details.support').get_attribute('open') is None:
            page.locator('details.support > summary').click()
        page.locator('#clear').click()
    def reset():
        clear()
        emit({'kind':'hello'})
        emit({'kind':'session','transport':'online','wpm':1200,'unitMs':1,'room':'0000','session':123,'mode':'ai','maxTurns':8})
    reset()
    if args.case in ('all','crc'):
        broken=page.evaluate("""async()=>{let f=await frameFor('CRC test');const m=await import('/app/core/morse.mjs');let chars=[...f.wire];chars[chars.length-3]=chars[chars.length-3]==='A'?'B':'A';return chars.map(c=>m.INTERNATIONAL[c]).join(' ')}""")
        emit({'kind':'rx-wire','morse':broken})
        expect(page.locator('#crc-0')).to_contain_text('不一致',timeout=12000)
        print('PASS corrupted wire is rejected by the real CRC decoder',flush=True)
    if args.case=='all':
        reset();f=page.evaluate("frameFor('実際に復元する文字です。')")
        emit({'kind':'rx-wire','morse':f['morse']})
        page.wait_for_timeout(90);clear();page.wait_for_timeout(2200)
        expect(page.locator('#text-0')).to_have_text('')
        expect(page.locator('#letters-0')).to_have_text('')
        print('PASS clear cancels in-flight replay and stale callbacks',flush=True)
        reset();emit({'kind':'inference-input','seq':2,'input':'相手から復元した実入力','messageCount':3,'inputBytes':384,'maxBytes':120,'attempt':0})
        expect(page.locator('#input-0')).to_have_text('相手から復元した実入力')
        expect(page.locator('#phase-0')).to_contain_text('考えています')
        emit({'kind':'generated','seq':2,'text':'生成した返答','inferenceMs':760,'origin':'ai'})
        expect(page.locator('#output-0')).to_have_text('生成した返答')
        expect(page.locator('#inference-0')).to_contain_text('0.76')
        print('PASS real event fields drive input, generation and elapsed-time UI',flush=True)
        reset();f=page.evaluate("frameFor('会話は一度だけ表示します。')")
        emit({'kind':'tx','seq':1,'type':'data','text':f['frame']['text'],'wire':f['wire'],'bytes':f['bytes']})
        emit({'kind':'frame','role':1,'frame':f['frame']})
        page.wait_for_timeout(2300)
        assert page.locator('#log .msg.a').count()==1
        print('PASS one turn is not duplicated by TX and RX telemetry',flush=True)
        emit({'kind':'stopped','message':'試験停止'})
        expect(page.locator('#chip-a')).not_to_have_class('chip on')
        expect(page.locator('#phase-0')).to_have_text('停止')
        page.reload();page.wait_for_timeout(500)
        expect(page.locator('#chip-a')).not_to_have_class('chip on')
        expect(page.locator('#text-1')).to_contain_text('会話は一度だけ表示します。')
        page.evaluate(feed_script)
        print('PASS reload restores the final text and keeps stopped endpoint offline',flush=True)
        for width,height in [(1440,1100),(1280,900),(390,844)]:
            page.set_viewport_size({'width':width,'height':height})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
            sizes=page.evaluate("['decode-output','decode-letters'].map(id=>parseFloat(getComputedStyle(document.getElementById(id)).fontSize))")
            assert len(set(sizes))==1,sizes
        assert not errors,errors
        print('PASS desktop/mobile fit horizontally; alphabet and restored text share font size',flush=True)
        stages=page.evaluate("""async()=>{
          const {InlineMessage}=await import('/monitor/inline-message.mjs');
          const el=document.getElementById('message-0');window.inlineProof=new InlineMessage(el);
          inlineProof.update('N');const n=el.textContent;inlineProof.update('NA');
          return {n,na:el.textContent,latinSize:getComputedStyle(el.querySelector('.stage-r')).fontSize,bodySize:getComputedStyle(el).fontSize};
        }""")
        assert stages['n']=='N' and stages['na']=='NA' and stages['latinSize']==stages['bodySize'],stages
        expect(page.locator('#message-0')).to_have_text('な')
        boundary=page.evaluate("""async()=>{inlineProof.reset();inlineProof.update('KA N');await new Promise(r=>setTimeout(r,120));const open=document.getElementById('message-0').textContent;inlineProof.update('KA N ');return {open,closed:document.getElementById('message-0').textContent}}""")
        assert boundary=={'open':'かN','closed':'かN'},boundary
        expect(page.locator('#message-0')).to_have_text('かん')
        assert not page.locator('.shared-decoder').is_visible()
        print('PASS N -> NA -> な changes inside the message body, at the same font size',flush=True)
        reset();emit({'kind':'channel','role':1,'sender':0,'seq':1,'type':'data'})
        emit({'kind':'mark','role':1,'signalSender':0,'signalSeq':1,'units':3,'on':True})
        expect(page.locator('#phase-0')).to_have_text('送信中')
        expect(page.locator('#phase-1')).to_have_text('聞いています')
        assert page.locator('#strip').get_attribute('data-signal-role')=='0'
        print('PASS sender A owns the signal colour while receiver B owns the decoder event',flush=True)
        emit({'kind':'channel','role':0,'sender':1,'seq':1,'type':'ack'})
        emit({'kind':'phonetic-tx','role':1,'seq':1,'type':'ack'})
        expect(page.locator('#lane-1 .ack-message')).to_contain_text('端末Bがメッセージ1の受信を確認しました（本文なしACK）。')
        expect(page.locator('#lane-1 .ack-message')).to_contain_text('送信中')
        emit({'kind':'mark','role':0,'signalSender':1,'signalSeq':1,'signalType':'ack','units':1,'on':True})
        emit({'kind':'generated','role':1,'seq':2,'text':'次の返答','inferenceMs':400,'origin':'ai'})
        expect(page.locator('#phase-0')).to_have_text('到達確認を待機')
        expect(page.locator('#phase-1')).to_have_text('受信確認を送信')
        assert page.locator('#strip').get_attribute('data-signal-role')=='1'
        emit({'kind':'channel','role':0,'sender':1,'seq':1,'type':'ack','phase':'complete'})
        expect(page.locator('#phase-1')).to_have_text('返答を送信準備')
        emit({'kind':'ack-sent','role':1,'seq':1})
        expect(page.locator('#lane-1 .ack-message')).to_contain_text('送信済み')
        print('PASS blue ACK signal is labelled as B confirmation, never as A message audio',flush=True)
        reset();emit({'kind':'topic-context','role':0,'topic':'会話して','starter':True,'peer':1})
        emit({'kind':'topic-context','role':1,'topic':'会話して','starter':False,'peer':0})
        emit({'kind':'inference-input','role':0,'seq':1,'inputOrigin':'topic','input':'会話して','messageCount':2,'inputBytes':100,'maxBytes':78,'attempt':0})
        expect(page.locator('#awareness-0')).to_contain_text('会話して')
        assert 'Bから受信' not in page.locator('#awareness-0').inner_text()
        expect(page.locator('#awareness-1')).to_contain_text('Aの発言を受け取ってから返答します')
        expect(page.locator('#awareness-0 .cognition-heading')).to_contain_text('推論')
        assert float(page.locator('#awareness-0 .cognition-row span').first.evaluate('(e)=>getComputedStyle(e).fontSize').replace('px',''))>=14
        print('PASS operator topic is shared context; it is never mislabelled as a B utterance',flush=True)
        formatted=page.evaluate("""()=>{
          inlineProof.reset();inlineProof.update('HA NA SHI',{final:true,animate:false});
          const accepted=inlineProof.format('話',{wire:'HA NA SHI'}),el=document.getElementById('message-0');
          inlineProof.update('HA NA SHI',{final:true});const text=el.textContent,kana=el.dataset.kana;
          inlineProof.reset();inlineProof.update('NA');const rejected=!inlineProof.format('古い話',{wire:'HA NA SHI'});
          return {accepted,text,kana,rejected};
        }""")
        assert formatted=={'accepted':True,'text':'話','kana':'はなし','rejected':True},formatted
        print('PASS kanji replaces only its verified kana; duplicates and stale results cannot overwrite the next message',flush=True)
        waiting=page.evaluate("""()=>{
          inlineProof.reset();inlineProof.update('HA NA SHI',{final:true,animate:false});inlineProof.format('話',{wire:'HA NA SHI'});
          inlineProof.waiting();const placeholder=document.getElementById('message-0').textContent;
          const staleAccepted=inlineProof.format('古い話',{wire:'HA NA SHI'});
          inlineProof.update('NA',{animate:false});return {placeholder,staleAccepted,text:document.getElementById('message-0').textContent};
        }""")
        assert waiting=={'placeholder':'返答を待っています','staleAccepted':False,'text':'な'},waiting
        print('PASS waiting clears the old message, rejects late formatting, and yields to received letters',flush=True)
        ack=page.evaluate("""async()=>{
          const {AckMessage}=await import('/monitor/ack-message.mjs');const a=new AckMessage(document.getElementById('message-0'));
          a.begin(1,9,'receiving');const empty=a.body.textContent;
          a.progress(1,9,'J');const first=a.body.textContent;a.progress(1,9,'JU');await new Promise(r=>setTimeout(r,130));const kana=a.body.textContent;
          const wire='JU SHI N SHI MA SHI TA';a.progress(1,9,wire,{final:true,state:'received'});const decoded=a.body.textContent;a.format(1,9,wire,'受信しました');const final=a.body.textContent;
          a.hide();a.begin(1,10,'receiving');const next=a.body.textContent;a.root.remove();return {empty,first,kana,decoded,final,next};
        }""")
        assert ack=={'empty':'','first':'J','kana':'じゅ','decoded':'じゅしんしました','final':'受信しました','next':''},ack
        print('PASS ACK is transcribed from received letters, with no prefilled receiver text',flush=True)
        assert page.locator('#sound').get_attribute('data-audio-state')=='closed'
        assert page.locator('#sound-label').inner_text()!='音あり'
        page.locator('#sound-test').click()
        page.wait_for_function("()=>Number(document.getElementById('sound').dataset.rms)>.002")
        page.wait_for_function("()=>document.getElementById('sound').dataset.playing==='false'")
        emit({'kind':'session','role':0,'transport':'backend-phonetic','language':'ja','wpm':60,'unitMs':20,'room':'0000','session':123,'mode':'ai','maxTurns':4})
        wire=page.evaluate("async()=>{const c=await import('/app/core/phonetic-morse.mjs');return c.packPhonetic({sender:0,seq:1,wire:'NA'});}")
        page.evaluate("wire=>emit({kind:'phonetic-tx',role:0,seq:1,type:'data',text:'な',payload:'NA',wire,audioStart:Date.now()+50})",wire)
        page.wait_for_function("()=>Number(document.getElementById('sound').dataset.rms)>.002")
        page.locator('#sound').click()
        expect(page.locator('#sound')).to_have_attribute('aria-pressed','false')
        page.wait_for_function("()=>Number(document.getElementById('sound').dataset.rms)<.0001")
        page.evaluate('feed.close()')
        page.wait_for_function("()=>document.getElementById('sound').dataset.audioState==='closed'")
        print('PASS audible probe and observer-owned playback work without starting a conversation; mute and disconnect release output',flush=True)
        browser.close()
