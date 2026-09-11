#!/usr/bin/env python3
"""Download the Google-linked E2B LiteRT artifact, pin resolved revision and verify LFS SHA256.
The model is not bundled, renamed from another architecture, or replaced with a test double.
"""
import argparse
import hashlib
import json
import re
import shutil
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = 'litert-community/gemma-4-E2B-it-litert-lm'
NAME = 'gemma-4-E2B-it.litertlm'
MAX_SIZE = 4 * 1024**3

class HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise ValueError('Refusing a non-HTTPS redirect')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def artifact(metadata):
    revision = metadata.get('sha', '')
    if not re.fullmatch(r'[0-9a-f]{40}', revision):
        raise ValueError('Missing immutable model revision')
    matches = [f for f in metadata.get('siblings', []) if f.get('rfilename') == NAME]
    if len(matches) != 1:
        raise ValueError('Exact E2B .litertlm artifact not found')
    lfs = matches[0].get('lfs', {})
    size, sha = lfs.get('size'), lfs.get('sha256', '')
    if not isinstance(size, int) or not 100*1024**2 <= size <= MAX_SIZE or not re.fullmatch(r'[0-9a-f]{64}', sha):
        raise ValueError('Missing size or SHA256 for exact model')
    return revision, size, sha


def download(destination: Path, evidence: Path):
    opener = urllib.request.build_opener(HttpsOnly())
    req = urllib.request.Request(f'https://huggingface.co/api/models/{REPO}?blobs=true', headers={'User-Agent': 'MorseTalk-verification/0.3'})
    with opener.open(req, timeout=60) as response:
        raw = response.read(2*1024**2+1)
        if len(raw) > 2*1024**2:
            raise ValueError('Model metadata exceeds the limit')
        metadata = json.loads(raw)
    revision, size, expected = artifact(metadata)
    destination.parent.mkdir(parents=True, exist_ok=True)
    evidence.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(destination.parent).free < size + 256*1024**2:
        raise OSError('Insufficient space for the actual E2B model')
    url = f'https://huggingface.co/{REPO}/resolve/{revision}/{NAME}'
    temporary = destination.with_suffix('.part')
    start, count, digest = time.monotonic(), 0, hashlib.sha256()
    try:
        with opener.open(urllib.request.Request(url, headers={'User-Agent': 'MorseTalk-verification/0.3'}), timeout=120) as source, temporary.open('wb') as target:
            while True:
                if time.monotonic() - start > 900:
                    raise TimeoutError('Model download exceeded 15 minute bound')
                chunk = source.read(1024**2)
                if not chunk:
                    break
                count += len(chunk)
                if count > size:
                    raise ValueError('Downloaded data exceeds declared model size')
                target.write(chunk)
                digest.update(chunk)
        if count != size or digest.hexdigest() != expected:
            raise ValueError('Model integrity verification failed')
        temporary.replace(destination)
        proof = dict(repository=REPO, revision=revision, filename=NAME, bytes=size,
                     sha256=expected, downloadSeconds=time.monotonic()-start, source=url,
                     verifiedLfsDigest=True, inferenceTested=False)
        evidence.write_text(json.dumps(proof, indent=2)+'\n', encoding='utf-8')
        print(json.dumps(proof, indent=2), flush=True)
        return proof
    finally:
        temporary.unlink(missing_ok=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--output', type=Path, default=Path('.models') / NAME)
    p.add_argument('--evidence', type=Path, default=Path('test-results/local-model-provenance.json'))
    args = p.parse_args()
    download(args.output, args.evidence)
