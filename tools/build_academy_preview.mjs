#!/usr/bin/env node
/** Standalone learning preview. Actual AI uses the existing AI Link integration. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const seen=new Map(),ordered=[];
async function visit(file){
  file=path.resolve(file);if(seen.has(file))return seen.get(file);
  const name=`module${seen.size}`;seen.set(file,name);let source=await fs.readFile(file,'utf8');
  const imports=[...source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm)];
  for(const imp of imports){
    if(!imp[2].startsWith('.'))throw new Error(`External import: ${imp[2]}`);
    const dep=await visit(path.resolve(path.dirname(file),imp[2]));source=source.replace(imp[0],`const {${imp[1].replace(/\s+as\s+/g,':')}}=${dep};`);
  }
  const exports=[...source.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map(x=>x[1]);
  source=source.replace(/^export\s+/gm,'');if(/^import\s/m.test(source))throw new Error(`Unsupported import in ${file}`);
  ordered.push(`const ${name}=(()=>{\n${source}\nreturn {${exports.join(',')}};})();`);return name;
}
const entry=await visit(path.join(root,'app/js/academy-app.mjs'));
const script=`(()=>{'use strict';\n${ordered.join('\n')}\n${entry}.mountAcademy({startOpen:true});})();`.replace(/<\/script/gi,'<\\/script');
if(process.argv.includes('--script-only'))process.stdout.write(script);
else {
  const license=await fs.readFile(path.join(root,'app/licenses/MIT-MorseTalk.txt'),'utf8');
  const html=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MorseTalk · Signal School</title></head><body><main style="max-width:760px;margin:40px auto;padding:20px;font:16px/1.8 sans-serif"><header><h1>MorseTalk · 学習プレビュー</h1></header><p>学習・音の再生・入力・採点は、このHTMLだけで動作します。AI交信はMorseTalkのAI Linkから「モールスを覚える」を開き、導入済みモデルと利用許可を設定してください。このプレビューにAIモデルやAIの代替応答は含まれていません。</p><p>ブラウザによって保存が利用できない場合があります。必要な記録は書き出してください。</p><details><summary>MIT License</summary><pre style="white-space:pre-wrap">${license.replaceAll('&','&amp;').replaceAll('<','&lt;')}</pre></details></main><script>${script}</script></body></html>`;
  await fs.mkdir(path.join(root,'dist'),{recursive:true});await fs.writeFile(path.join(root,'dist/MorseTalk-Signal-School-Preview.html'),html);console.log(`Built ${Buffer.byteLength(html)} bytes. Zero remote assets.`);
}
