#!/usr/bin/env python3
"""Build Android with existing SDK + JDK; optionally download fixed Gradle.
No administrator access, SDK license acceptance, publishing, or release signing.
"""
import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
ROOT=Path(__file__).resolve().parents[1]
VERSION='8.11.1'
URL=f'https://services.gradle.org/distributions/gradle-{VERSION}-bin.zip'
LIMIT=180*1024*1024

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--yes',action='store_true');p.add_argument('--task',choices=['assembleDebug','lintDebug','wrapper'],default='assembleDebug');a=p.parse_args()
 env=dict(os.environ)
 sdk=env.get('ANDROID_HOME') or env.get('ANDROID_SDK_ROOT')
 if not sdk and os.name=='nt':
  candidate=Path(env.get('LOCALAPPDATA',''))/'Android/Sdk'
  if candidate.is_dir():sdk=str(candidate)
 if not sdk and not (ROOT/'android/local.properties').is_file():
  raise SystemExit('Android SDK not found. Install Android Studio and SDK Platform 35 / Build Tools 35.0.0, then set ANDROID_HOME or android/local.properties (sdk.dir).')
 if sdk:env['ANDROID_HOME']=sdk
 if not env.get('JAVA_HOME') and os.name=='nt':
  jbr=Path(env.get('ProgramFiles','C:/Program Files'))/'Android/Android Studio/jbr'
  if (jbr/'bin/java.exe').is_file():env['JAVA_HOME']=str(jbr)
 if not env.get('JAVA_HOME') and not shutil.which('java'):raise SystemExit('JDK 17+ is required. Set JAVA_HOME to Android Studio jbr or your JDK.')
 cache=ROOT/'.tools';distribution=cache/f'gradle-{VERSION}'
 binary=distribution/'bin'/('gradle.bat' if os.name=='nt' else 'gradle')
 if not binary.is_file():
  if not a.yes and input('Download free Gradle 8.11.1 and build dependencies? No audio is uploaded. Type YES: ').strip()!='YES':raise SystemExit('Cancelled.')
  cache.mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(prefix='gradle-stage-',dir=cache) as temp:
   stage=Path(temp);archive=stage/'gradle.zip'
   with urllib.request.urlopen(URL+'.sha256',timeout=60) as r:expected=r.read(1024).decode('ascii').strip()
   if len(expected)!=64 or any(c not in '0123456789abcdef' for c in expected):raise SystemExit('Invalid official Gradle checksum response.')
   h=hashlib.sha256();size=0
   with urllib.request.urlopen(URL,timeout=60) as r, archive.open('wb') as out:
    while True:
     block=r.read(1024*1024)
     if not block:break
     size+=len(block)
     if size>LIMIT:raise SystemExit('Gradle download exceeded size limit.')
     h.update(block);out.write(block)
   if h.hexdigest()!=expected:raise SystemExit('Gradle SHA-256 mismatch. Nothing was executed.')
   with zipfile.ZipFile(archive) as z:
    infos=z.infolist()
    if len(infos)>10000 or sum(i.file_size for i in infos)>600*1024*1024:raise SystemExit('Oversized Gradle archive.')
    for info in infos:
     q=PurePosixPath(info.filename)
     if q.is_absolute() or '..' in q.parts or '\\' in info.filename or ':' in info.filename or not q.parts or q.parts[0]!=f'gradle-{VERSION}' or ((info.external_attr>>16)&0o170000)==0o120000:raise SystemExit('Unsafe Gradle archive.')
     target=stage.joinpath(*q.parts)
     if info.is_dir():target.mkdir(parents=True,exist_ok=True)
     else:
      target.parent.mkdir(parents=True,exist_ok=True)
      with z.open(info) as src,target.open('xb') as dst:shutil.copyfileobj(src,dst)
   if distribution.exists():raise SystemExit('Incomplete cached Gradle exists. Inspect and remove .tools/gradle-8.11.1 before retrying.')
   (stage/f'gradle-{VERSION}').rename(distribution)
   (distribution/'MorseTalk-SHA256.txt').write_text(expected+'\n')
  if os.name!='nt':binary.chmod(binary.stat().st_mode|0o111)
 args=[str(binary),'--no-daemon','--console=plain',a.task]
 if a.task=='wrapper':args+=['--gradle-version',VERSION,'--distribution-type','bin']
 result=subprocess.run(args,cwd=ROOT/'android',env=env,check=False)
 if result.returncode:raise SystemExit(result.returncode)
 if a.task=='assembleDebug':
  apk=ROOT/'android/app/build/outputs/apk/debug/app-debug.apk'
  if not apk.is_file():raise SystemExit('Gradle returned success but APK is missing.')
  print(f'APK: {apk}\nDebug key only. Do not publish this as a signed release.')
if __name__=='__main__':main()
