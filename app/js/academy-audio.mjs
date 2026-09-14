/** One oscillator per operation. Web Audio clock controls tones, not DOM timers. */
export class AcademyAudio {
  constructor({onSignal=()=>{}}={}){this.context=null;this.nodes=[];this.timers=[];this.finish=null;this.onSignal=onSignal;this.generation=0;}
  async ready(){
    const Context=globalThis.AudioContext||globalThis.webkitAudioContext;
    if(!Context)throw new Error('この環境では音声を再生できません。対応ブラウザで開いてください。');
    if(!this.context||this.context.state==='closed')this.context=new Context();
    if(this.context.state==='suspended')await this.context.resume();
    if(this.context.state!=='running')throw new Error('音声を開始できません。再生ボタンをもう一度押してください。');
  }
  stop(){
    ++this.generation;this.timers.forEach(clearTimeout);this.timers=[];
    for(const node of this.nodes){try{node.oscillator.onended=null;node.oscillator.stop();node.oscillator.disconnect();node.gain.disconnect();}catch{}}
    this.nodes=[];this.onSignal(false);const finish=this.finish;this.finish=null;finish?.(false);
  }
  async play(segments,{frequency=600,volume=.12}={}){
    this.stop();const generation=this.generation;await this.ready();
    if(generation!==this.generation)return false;
    if(!Array.isArray(segments)||segments.length>2400||!segments.length||segments.some(s=>typeof s.on!=='boolean'||!Number.isFinite(s.seconds)||s.seconds<=0))throw new Error('再生データが不正です。');
    const duration=segments.reduce((n,s)=>n+s.seconds,0);
    if(duration>180||!Number.isFinite(frequency)||frequency<400||frequency>1000||!Number.isFinite(volume)||volume<.01||volume>.3)throw new Error('音声設定が範囲外です。');
    const context=this.context,oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.frequency.value=frequency;oscillator.connect(gain);gain.connect(context.destination);gain.gain.value=0;
    const start=context.currentTime+.025;let at=start;
    for(const segment of segments){
      if(segment.on){
        const ramp=Math.min(.003,segment.seconds/4);
        gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(volume,at+ramp);gain.gain.setValueAtTime(volume,at+segment.seconds-ramp);gain.gain.linearRampToValueAtTime(0,at+segment.seconds);
        this.timers.push(setTimeout(()=>{if(generation===this.generation)this.onSignal(true);},(at-context.currentTime)*1000));
        this.timers.push(setTimeout(()=>{if(generation===this.generation)this.onSignal(false);},(at+segment.seconds-context.currentTime)*1000));
      }
      at+=segment.seconds;
    }
    this.nodes.push({oscillator,gain});
    return new Promise(resolve=>{
      this.finish=resolve;
      oscillator.onended=()=>{if(generation!==this.generation)return;this.finish=null;this.nodes=[];this.timers.forEach(clearTimeout);this.timers=[];this.onSignal(false);oscillator.disconnect();gain.disconnect();resolve(true);};
      oscillator.start(start);oscillator.stop(at);
    });
  }
  async keyDown({frequency=600,volume=.1}={}){
    this.stop();const generation=this.generation;await this.ready();if(generation!==this.generation)return;
    const context=this.context,oscillator=context.createOscillator(),gain=context.createGain();
    oscillator.frequency.value=frequency;gain.gain.value=0;oscillator.connect(gain);gain.connect(context.destination);gain.gain.linearRampToValueAtTime(volume,context.currentTime+.003);oscillator.start();
    this.nodes.push({oscillator,gain});this.onSignal(true);
  }
  dispose(){this.stop();const context=this.context;this.context=null;return context?.close().catch(()=>{});}
}
