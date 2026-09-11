import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('All shipped launchers and verification entrypoints exist',()=>{
  for(const file of ['windows/server.ps1','windows/recognize.ps1','windows/setup-vosk.ps1','windows/smoke-test.ps1','tools/build_android.py','tools/download_model.py','tools/test_ui.py','tools/test_ui_inmemory.py','tools/test_ai_ui.py','tools/test_fast_browser.py','tools/test_audio_pair.py','tools/audio_pair.mjs','tools/browser_support.py','tools/test_real_ai.py','tools/start_ci_model.sh','tools/android_smoke.sh'])
    assert.ok(fs.statSync(path.join(root,file)).size>0,`Missing ${file}`);
});
test('Every production relative ESM dependency is tracked source, not a stale bundle',()=>{
  const visit=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?visit(path.join(dir,e.name)):[path.join(dir,e.name)]);
  for(const file of visit(path.join(root,'app')).filter(f=>f.endsWith('.mjs'))){
    for(const m of fs.readFileSync(file,'utf8').matchAll(/from\s*['"](\.[^'"]+)['"]/g))assert.ok(fs.existsSync(path.resolve(path.dirname(file),m[1])),`${file}: ${m[1]}`);
  }
});
