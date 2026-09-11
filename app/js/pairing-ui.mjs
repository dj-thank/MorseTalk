import { connectionCode, parseConnectionCode, newSessionId } from '../core/session-tools.mjs';
import { newInvite, inviteCode, parseInvite, validateInvite } from '../core/online-protocol.mjs';
import { hasNative, nativeCall } from './voice.mjs';
/** QR pixels are processed only on this device. Nothing is opened from scanned text. */
export function renderPairQR(canvas,text) {
  if(typeof text!=='string'||text.length>1400||!/^[\x20-\x7e]+$/.test(text))throw Error('QRの内容が不正です。');
  if(typeof globalThis.qrcode!=='function')throw Error('同梱QR生成器を読み込めません。');
  const qr=globalThis.qrcode(0,'M');qr.addData(text,'Byte');qr.make();
  const size=qr.getModuleCount(),scale=6;
  canvas.width=canvas.height=(size+8)*scale;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
  for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(qr.isDark(y,x))ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);
  return {modules:size,pixels:canvas.width};
}
export class QRScanner {
  constructor({video,onResult,onError,onBusy}) { Object.assign(this,{video,onResult,onError,onBusy});this.epoch=0;this.active=false; }
  stop() {
    ++this.epoch;clearTimeout(this.timer);this.timer=null;
    const stream=this.stream;this.stream=null;
    // Release every track even when a device has already disappeared.
    for(const track of stream?.getTracks()||[]){track.onended=null;try{track.stop();}catch{}}
    try{this.video.pause();}catch{}
    try{this.video.srcObject=null;}catch{}
    if(this.active){this.active=false;this.onBusy(false);}
  }
  read(source) {
    if(typeof globalThis.jsQR!=='function')throw Error('同梱QR読取器を読み込めません。');
    const w=source.videoWidth||source.width,h=source.videoHeight||source.height;
    if(!w||!h)return null;
    const ratio=Math.min(1,1000/Math.max(w,h)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height);
    return globalThis.jsQR(data.data,data.width,data.height,{inversionAttempts:'dontInvert'})?.data||null;
  }
  async start() {
    this.stop();this.active=true;this.onBusy(true);const epoch=this.epoch;
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw Error('カメラを利用できません。QR画像または接続コードを使ってください。');
      const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
      if(epoch!==this.epoch){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;
      for(const track of stream.getTracks())track.onended=()=>{
        if(epoch!==this.epoch)return;
        this.stop();this.onError(Error('カメラが切断されました。再度開始するか、QR画像を使ってください。'));
      };
      this.video.srcObject=stream;await this.video.play();
      if(epoch!==this.epoch)return;
      const scan=()=>{
        if(epoch!==this.epoch)return;
        try {const text=this.read(this.video);if(text){this.stop();this.onResult(text);return;}}
        catch(e){this.stop();this.onError(e);return;}
        this.timer=setTimeout(scan,200);
      };scan();
    }catch(e){if(epoch===this.epoch){this.stop();this.onError(Error('カメラを開始できません。権限を確認するか、QR画像を読み込んでください。'));}}
  }
  async image(file) {
    this.stop();const epoch=this.epoch;
    if(!file||file.size>8*1024*1024||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('QR画像はPNG/JPEG/WebPの8 MB以下にしてください。');
    this.active=true;this.onBusy(true);
    let bitmap;
    try {
      bitmap=await createImageBitmap(file);
      if(epoch!==this.epoch)return;
      const text=this.read(bitmap);if(!text)throw Error('QRを読み取れません。余白を含めた鮮明な画像を使ってください。');
      this.stop();this.onResult(text);
    }finally{bitmap?.close();if(epoch===this.epoch)this.stop();}
  }
}
export function createPairingUI({options,changed,error,scanBusy}) {
  const $=id=>document.getElementById(id);let locked=false,invite=null,candidate=null,shown='';
  function settings(p) { $('room').value=p.room;$('session').value=p.session.toString(16).toUpperCase().padStart(8,'0');$('speed').value=String(p.wpm);$('turns').value=String(p.maxTurns);$('max-bytes').value=String(p.maxReplyBytes); }
  const mode=()=>{$('online-settings').hidden=$('transport').value!=='online';changed();};
  const show=text=>{renderPairQR($('pair-qr'),text);shown=text;$('qr-output').hidden=false;$('qr-save').disabled=false;};
  function stage(text) {
    if(locked)throw Error('先にすべて停止してください。');
    candidate=null;$('qr-apply').disabled=true;
    const input=text.trim();if(input.startsWith('MTO1.')){
      const value=parseInvite(input);candidate={invite:value,settings:parseConnectionCode(value.p)};
      $('qr-preview').textContent=`オンライン接続先：${new URL(value.r).host} / ${value.r}。有効期限：${new Date(value.e).toLocaleTimeString()}。この招待の鍵を持つ相手と接続します。適用後は端末Bになります。`;
    } else {
      candidate={settings:parseConnectionCode(input)};$('qr-preview').textContent='音響モールスの接続設定です。速度・セッション・会話上限だけを反映します。A/Bの役割は変えません。';
    }
    $('qr-input').value=input;$('qr-apply').disabled=false;
  }
  const scanner=new QRScanner({video:$('qr-video'),onResult:t=>{try{stage(t);}catch(e){error(e);}},onError:error,onBusy:value=>{$('qr-camera').hidden=!value;$('qr-camera-stop').disabled=!value;scanBusy(value);}});
  function action(id,fn){$(id).addEventListener('click',async()=>{try{if(locked)throw Error('先にすべて停止してください。');await fn();}catch(e){error(e);}});}
  $('transport').addEventListener('change',mode);
  action('use-usb',()=>{
    // Explicit setup only; never start ADB, networking, inference or recording.
    invite=null;candidate=null;shown='';
    $('invite-text').value='';$('qr-input').value='';$('qr-output').hidden=true;$('qr-apply').disabled=true;
    $('transport').value='online';$('relay-url').value='ws://127.0.0.1:8787/v1';$('network-consent').checked=false;
    mode();$('online-note').textContent='USB接続先だけを設定しました。PCでStart-PC-Android.cmdを実行し、Aで招待QRを作成→Bで確認して適用→両端でネット交信を許可してください。AIやマイクは開始していません。';
  });
  action('show-acoustic-qr',()=>show(connectionCode(options())));
  action('make-online',()=>{
    const opts=options(),value=newInvite($('relay-url').value,{...opts,session:newSessionId()});
    const text=inviteCode(value);show(text);invite=value;settings(parseConnectionCode(value.p));$('role').value='0';$('invite-text').value=text;
    $('network-consent').checked=false;$('online-note').textContent='招待を作りました。相手にQRか招待文を渡し、両端で接続先を確認して「受信待機を開始」を押します。有効期限15分。';changed();
  });
  action('copy-invite',async()=>{
    if(!invite)throw Error('先に招待を作るか適用してください。');const text=inviteCode(invite);$('invite-text').value=text;
    try{await navigator.clipboard.writeText(text);$('online-note').textContent='招待をコピーしました。公開せず、相手だけに送ってください。';}
    catch{$('invite-text').focus();$('invite-text').select();$('online-note').textContent='招待文を選択しました。端末のコピー操作を使ってください。';}
  });
  action('qr-stage',()=>stage($('qr-input').value));
  $('qr-input').addEventListener('input',()=>{candidate=null;$('qr-apply').disabled=true;$('qr-preview').textContent='「内容を確認」を押してください。';});
  action('qr-apply',()=>{
    if(!candidate)throw Error('先に読み取り内容を確認してください。');
    if(candidate.invite){invite=validateInvite(candidate.invite);$('transport').value='online';$('relay-url').value=invite.r;$('role').value='1';$('invite-text').value=inviteCode(invite);$('network-consent').checked=false;}
    else {invite=null;$('transport').value='acoustic';}
    settings(candidate.settings);candidate=null;$('qr-apply').disabled=true;mode();$('qr-preview').textContent='設定だけを反映しました。まだネット接続・録音・AI生成は始めていません。';
  });
  action('scan-qr',()=>scanner.start());$('qr-camera-stop').onclick=()=>scanner.stop();
  $('qr-image').addEventListener('change',async()=>{try{if(locked)throw Error('先にすべて停止してください。');await scanner.image($('qr-image').files[0]);}catch(e){error(e);}finally{$('qr-image').value='';}});
  action('qr-save',async()=>{
    if(!shown)throw Error('先にQRを表示してください。');
    if(shown.startsWith('MTO1.'))parseInvite(shown);
    const url=$('pair-qr').toDataURL('image/png');
    if(hasNative())await nativeCall('saveFile',{filename:'MorseTalk-pairing.png',mime:'image/png',base64:url.split(',')[1]},180000);
    else {const a=document.createElement('a');a.href=url;a.download='MorseTalk-pairing.png';a.click();}
  });
  return {
    lock(value){locked=value;for(const id of ['use-usb','transport','dialogue-mode','relay-url','make-online','copy-invite','network-consent','show-acoustic-qr','scan-qr','qr-image','qr-stage','qr-input','qr-save'])$(id).disabled=value;$('qr-apply').disabled=value||!candidate;},
    get(){if($('transport').value!=='online')return null;if(!$('network-consent').checked)throw Error('オンラインの接続先と招待共有を確認して許可してください。');
      if(!invite)throw Error('先にオンライン招待を作るか、相手の招待を適用してください。');
      validateInvite(invite);if(connectionCode(options())!==invite.p||$('relay-url').value!==invite.r)throw Error('招待と現在の設定が違います。新しい招待を作成してください。');return invite;},
    stopScan(){scanner.stop();},
    forget(){invite=null;candidate=null;shown='';$('invite-text').value='';$('qr-input').value='';$('qr-output').hidden=true;$('network-consent').checked=false;$('qr-apply').disabled=true;},
  };
}
