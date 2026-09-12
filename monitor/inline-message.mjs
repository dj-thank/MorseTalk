import { ROMAJI_KANA } from '../app/core/phonetic-morse.mjs';
const romanTokens=Object.keys(ROMAJI_KANA);

export function messageCells(wire,{language='ja',final=false,boundary=false}={}){
  if(language==='en')return [...wire].map(text=>({roman:text,text,ready:true,convert:false}));
  const closed=boundary||final||/\s$/.test(wire);
  const tokens=wire.split(' ').filter(Boolean);
  return tokens.map((roman,i)=>({roman,text:ROMAJI_KANA[roman]||roman,convert:true,
    ready:Boolean(ROMAJI_KANA[roman])&&(closed||i<tokens.length-1||!romanTokens.some(t=>t!==roman&&t.startsWith(roman)))}));
}

/** The original message-cell reveal, now driven by actually received letters:
 * one cell in the sentence changes N -> NA -> な, without a separate panel.
 */
export class InlineMessage {
  constructor(element,{delay=105}={}){this.element=element;this.delay=delay;this.epoch=0;this.cells=[];this.reset();}
  reset(){
    this.placeholderNode=null;this.element.classList.remove('waiting');
    this.epoch++;for(const cell of this.cells){clearTimeout(cell.timer);clearTimeout(cell.finish);}
    this.cells=[];this.formattedWire=null;this.caret=document.createElement('span');this.caret.className='caret';this.element.replaceChildren(this.caret);this.element.dataset.wire='';this.element.dataset.kana='';this.element.removeAttribute('title');this.element.classList.remove('kanji-formatted','receive-error');
  }
  update(wire,{language='ja',final=false,boundary=false,animate=true}={}){
    this.placeholderNode?.remove();this.placeholderNode=null;this.element.classList.remove('waiting');
    if(wire===this.formattedWire)return;
    const specs=messageCells(wire,{language,final,boundary});
    if(specs.length<this.cells.length)this.reset();
    const epoch=this.epoch;
    specs.forEach((spec,index)=>{
      let cell=this.cells[index];
      if(!cell){const node=document.createElement('span');node.className='ch';this.caret.before(node);cell={node};this.cells[index]=cell;}
      if(cell.roman===spec.roman&&cell.ready===spec.ready&&cell.language===language)return;
      clearTimeout(cell.timer);clearTimeout(cell.finish);cell.roman=spec.roman;cell.ready=spec.ready;cell.language=language;
      cell.node.textContent=spec.roman===' '?'\u00a0':spec.roman;cell.node.title=spec.roman;
      cell.node.className=spec.convert?'ch stage-r':'ch';
      if(spec.ready){
        const reveal=()=>{if(epoch!==this.epoch)return;cell.node.textContent=spec.text===' '?'\u00a0':spec.text;cell.node.className=animate&&spec.convert?'ch stage-k':'ch';
          cell.finish=setTimeout(()=>{if(epoch===this.epoch)cell.node.className='ch';},80);};
        if(animate&&spec.convert)cell.timer=setTimeout(reveal,this.delay);else reveal();
      }
    });
    this.element.dataset.wire=wire;this.element.classList.toggle('english',language==='en');
    this.caret.hidden=final;
  }
  format(text,{wire}={}){
    if(this.element.dataset.wire!==wire||!this.caret.hidden)return false;
    if(this.formattedWire===wire){if(this.element.textContent!==text)this.element.textContent=text;return true;}
    this.epoch++;for(const cell of this.cells){clearTimeout(cell.timer);clearTimeout(cell.finish);}
    this.element.dataset.kana=this.element.textContent;this.element.title=`受信したかな: ${this.element.textContent}`;
    this.formattedWire=wire;this.element.textContent=text;this.element.classList.add('kanji-formatted');return true;
  }
  waiting(text='返答を待っています'){this.reset();this.caret.hidden=true;this.placeholderNode=document.createElement('span');this.placeholderNode.textContent=text;this.caret.before(this.placeholderNode);this.element.classList.add('waiting');}
  plain(text){this.reset();this.update(text,{language:'en',final:true,animate:false});this.element.classList.remove('english');}
}
