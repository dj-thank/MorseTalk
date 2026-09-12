import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
async def main():
    async with async_playwright() as p:
        browser=await p.chromium.launch(channel='msedge',headless=True,args=['--mute-audio'])
        page=await browser.new_page(viewport={'width':412,'height':915})
        async def serve(route):
            path=route.request.url.split('http://signal.test/')[1]
            file=ROOT/path
            if path=='':await route.fulfill(body='<div id="chat"></div>',content_type='text/html')
            else:await route.fulfill(body=file.read_text(encoding='utf-8'),content_type='text/javascript')
        await page.route('http://signal.test/**',serve)
        await page.goto('http://signal.test/')
        result=await page.evaluate('''async()=>{
          const {SignalChat}=await import('/app/js/signal-chat.mjs');
          const chat=new SignalChat(document.querySelector('#chat'));chat.reset(0);
          chat.symbols('VVV');chat.symbols('B1+');chat.bind(1,1,'ack');
          chat.progress({sender:1,seq:1,type:'ack',wire:'JU',boundary:true});
          const ack={sender:1,seq:1,type:'ack',wire:'JU SHI N SHI MA SHI TA'};
          chat.received(ack);chat.format(ack,'受信しました');chat.raw=null;
          chat.progress({...ack,wire:'JU SHI'});chat.bind(1,1,'ack');chat.received(ack);
          if(chat.row(1,1,'ack').status.textContent!=='受信済み')throw Error('late candidate reverted delivery');
          const own=chat.begin(0,2,'data');own.message.plain('条件を確かめます');
          chat.symbols('B1+ JU SHI N SHI MA SHI TA / 276E36C5');
          if(own.node.textContent.includes('276E36C5'))throw Error('late ACK tail leaked into next bubble');
          chat.symbols('VVV');chat.symbols('B2= KA');chat.bind(1,2,'data');
          const next=chat.row(1,2,'data');
          if(next.node.textContent.includes('276E36C5'))throw Error('previous packet inherited');
          chat.format(ack,'受信しました');chat.begin(0,2,'data');
          if(document.querySelectorAll('.chat-message').length!==3)throw Error('duplicate bubble');
          const peer=document.querySelector('[data-self=false]');
          if(!peer.textContent.includes('VVV ｜ B1+'))throw Error('lost preamble');
          if(!peer.textContent.includes('受信しました'))throw Error('missing ACK body');
          if(!own.node.textContent.includes('条件を確かめます'))throw Error('late conversion overwrote current');
          chat.stop();if(own.status.textContent!=='停止')throw Error('stale sending');
          return 'PASS: ACK content, raw alphabet, packet identity, retry, delayed conversion, stop';
        }''')
        print(result)
        await browser.close()
asyncio.run(main())
