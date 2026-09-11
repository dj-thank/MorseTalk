#!/usr/bin/env node
/** Small, intentionally limited ESM bundler for these owned modules. No package install. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareMessage} from '../app/core/packet.mjs';
import {synthesize,pcmToWav} from '../app/core/morse.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function bundle(entry){
  const seen=new Map(),ordered=[];
  async function visit(file){
    file=path.resolve(file);if(seen.has(file))return seen.get(file);
    const name=`module${seen.size}`;seen.set(file,name);
    let source=await fs.readFile(file,'utf8');
    const imports=[...source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm)];
    for(const imp of imports){
      if(!imp[2].startsWith('.'))throw new Error(`External import: ${imp[2]}`);
      const dependency=await visit(path.resolve(path.dirname(file),imp[2]));
      const bindings=imp[1].replace(/\s+as\s+/g,':');
      source=source.replace(imp[0],`const {${bindings}}=${dependency};`);
    }
    const exports=[...source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map(x=>x[1]);
    source=source.replace(/^export\s+/gm,'').replaceAll('import.meta.url','document.baseURI');
    if(/^import\s/m.test(source))throw new Error(`Unsupported import in ${file}`);
    ordered.push(`const ${name}=(()=>{\n${source}\nreturn {${exports.join(',')}};\n})();`);return name;
  }
  await visit(path.join(root,entry));return `(()=>{\n'use strict';\n${ordered.join('\n')}\n})();`;
}
const main=await bundle('app/js/app.mjs'),worklet=await bundle('app/js/rx-worklet.mjs');
const script=`globalThis.__MORSETALK_WORKLET_SOURCE__=${JSON.stringify(worklet)};\n${main}`.replace(/<\/script/gi,'<\\/script');
let html=await fs.readFile(path.join(root,'app/index.html'),'utf8');
const css=await fs.readFile(path.join(root,'app/style.css'),'utf8');
const icon=(await fs.readFile(path.join(root,'app/icon.svg'))).toString('base64');
html=html.replace('<link rel="stylesheet" href="style.css">',`<style>\n${css}\n</style>`)
  .replace('href="ai.html"','href="MorseTalk-AI-Portable.html"')
  .replace('<link rel="manifest" href="manifest.webmanifest">','')
  .replace('href="icon.svg"',`href="data:image/svg+xml;base64,${icon}"`)
  .replace('__MORSETALK_TOKEN__','')
  .replace('<script type="module" src="js/app.mjs"></script>',`<script>\n${script}\n</script>`);
await fs.mkdir(path.join(root,'dist'),{recursive:true});
await fs.writeFile(path.join(root,'dist/MorseTalk-Portable.html'),html);
await fs.mkdir(path.join(root,'examples'),{recursive:true});
const settings=[];
for(const spec of [
  {file:'japanese-hai.wav',text:'はい',mode:'packet',room:'0000',id:20260911,wpm:40},
  {file:'japanese-konnichiwa.wav',text:'こんにちは',mode:'packet',room:'0000',id:20260912,wpm:40},
  {file:'international-hello.wav',text:'HELLO',mode:'international',wpm:18},
  {file:'wabun-arigato.wav',text:'ありがとう',mode:'wabun',wpm:18}
]){
  const prepared=prepareMessage(spec),pcm=synthesize(prepared.segments,{sampleRate:16000,frequency:700,volume:0.25});
  await fs.writeFile(path.join(root,'examples',spec.file),new Uint8Array(pcmToWav(pcm)));
  settings.push({...spec,frequency:700,sampleRate:16000,seconds:+prepared.seconds.toFixed(3),decodedText:prepared.normalized});
}
await fs.writeFile(path.join(root,'examples/settings.json'),JSON.stringify(settings,null,2)+'\n');
console.log(`Built dist/MorseTalk-Portable.html (${Buffer.byteLength(html)} bytes), ${settings.length} WAV examples. No model downloads.`);

// Separate fully-offline AI Link diagnostics build. Live AI still needs the local launcher/native bridge.
const fastMain=await bundle('app/js/ai-app.mjs'),fastWorklet=await bundle('app/js/fast-worklet.mjs');
let aiHtml=await fs.readFile(path.join(root,'app/ai.html'),'utf8');
const aiCss=await fs.readFile(path.join(root,'app/ai.css'),'utf8');
const aiScript=(`globalThis.__FAST_WORKLET_SOURCE__=${JSON.stringify(fastWorklet)};\n${fastMain}`).replace(/<\/script/gi,'<\\/script');
aiHtml=aiHtml.replace('href="index.html"','href="MorseTalk-Portable.html"').replace('<link rel="stylesheet" href="ai.css">',`<style>${aiCss}</style>`).replace('href="icon.svg"',`href="data:image/svg+xml;base64,${icon}"`).replace('__MORSETALK_TOKEN__','').replace('<script type="module" src="js/ai-app.mjs"></script>',`<script>${aiScript}</script>`);
await fs.writeFile(path.join(root,'dist/MorseTalk-AI-Portable.html'),aiHtml);
console.log(`Built dist/MorseTalk-AI-Portable.html (${Buffer.byteLength(aiHtml)} bytes).`);
