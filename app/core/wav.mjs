/** Strict, bounded uncompressed WAV reader. No third-party decoder or network. */
export function parseWav(input,{maxBytes=20*1024*1024,maxSeconds=300}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.byteLength<44||bytes.byteLength>maxBytes)throw new Error('WAVは44バイト〜20 MBの範囲にしてください。');
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const tag=(at)=>String.fromCharCode(...bytes.subarray(at,at+4));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE'||v.getUint32(4,true)+8!==bytes.length)throw new Error('RIFF/WAVE形式ではないか、ファイルが途中で切れています。');
  let format=null,data=null;
  let p=12;for(;p+8<=bytes.length;){
    const size=v.getUint32(p+4,true),end=p+8+size;
    if(end>bytes.length)throw new Error('WAVチャンクの長さが不正です。');
    if(tag(p)==='fmt '){
      if(format||size<16)throw new Error('WAVの形式ヘッダーが不正です。');
      format={encoding:v.getUint16(p+8,true),channels:v.getUint16(p+10,true),sampleRate:v.getUint32(p+12,true),byteRate:v.getUint32(p+16,true),align:v.getUint16(p+20,true),bits:v.getUint16(p+22,true)};
    }else if(tag(p)==='data'){
      if(data)throw new Error('複数のWAVデータチャンクは未対応です。');
      data={start:p+8,size};
    }
    p=end+(size%2);
  }
  if(p!==bytes.length)throw new Error('WAVの末尾チャンクが不正です。');
  if(!format||!data)throw new Error('WAVに音声データがありません。');
  const {encoding,channels,sampleRate,byteRate,align,bits}=format;
  if(![1,2].includes(channels)||sampleRate<8000||sampleRate>96000||!([8,16,24,32].includes(bits)&&encoding===1||encoding===3&&bits===32))throw new Error('対応WAVは1〜2チャンネル、8〜96 kHz、整数PCM 8/16/24/32 bit またはFloat32です。');
  const width=bits/8;
  if(align!==channels*width||byteRate!==sampleRate*align||data.size%align!==0)throw new Error('WAVのブロック長が不正です。');
  const frames=data.size/align;
  if(frames===0||frames/sampleRate>maxSeconds)throw new Error(`録音は1サンプル以上、${maxSeconds}秒以内にしてください。`);
  const pcm=new Float32Array(frames);
  for(let i=0;i<frames;i++){
    let sum=0;
    for(let c=0;c<channels;c++){
      const p=data.start+i*align+c*width;let x;
      if(encoding===3)x=v.getFloat32(p,true);
      else if(bits===8)x=(v.getUint8(p)-128)/128;
      else if(bits===16)x=v.getInt16(p,true)/32768;
      else if(bits===24){let n=v.getUint8(p)|(v.getUint8(p+1)<<8)|(v.getUint8(p+2)<<16);if(n&0x800000)n-=0x1000000;x=n/8388608;}
      else x=v.getInt32(p,true)/2147483648;
      if(!Number.isFinite(x))throw new Error('WAVに非数・無限大のサンプルがあります。');
      sum+=Math.max(-1,Math.min(1,x));
    }
    pcm[i]=sum/channels;
  }
  return {pcm,sampleRate,seconds:frames/sampleRate,channels};
}
