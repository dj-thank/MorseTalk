#!/usr/bin/env python3
"""Explicit model download only; never used automatically by the application.
Official Vosk model URLs; SHA256 is recorded for audit, not claimed to be a
publisher-signed checksum. Pass --sha256 to enforce an independently known hash.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
MODELS = {"ja-JP": "vosk-model-small-ja-0.22", "en-US": "vosk-model-small-en-us-0.15"}
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_EXPANDED = 350 * 1024 * 1024


def safe_extract(archive: Path, destination: Path, expected_root: str) -> None:
    with zipfile.ZipFile(archive) as z:
        infos = z.infolist()
        if len(infos) > 10000 or sum(i.file_size for i in infos) > MAX_EXPANDED:
            raise ValueError("Model archive is too large")
        for info in infos:
            path = PurePosixPath(info.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in info.filename or ":" in info.filename or not path.parts or path.parts[0] != expected_root:
                raise ValueError("Unsafe model archive path")
            if (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Symbolic links are not allowed in the model archive")
            target = destination.joinpath(*path.parts)
            if not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError("Unsafe model destination")
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with z.open(info) as src, target.open("xb") as dst:
                    shutil.copyfileobj(src, dst, length=65536)


def download(language: str, expected_hash: str | None = None) -> Path:
    name = MODELS[language]
    models = ROOT / "models"
    models.mkdir(exist_ok=True)
    target = models / name
    if target.exists():
        if not (target / "am" / "final.mdl").is_file():
            raise RuntimeError("An incomplete model folder already exists. Rename it before retrying.")
        print(f"Already present: {target}")
        return target
    url = f"https://alphacephei.com/vosk/models/{name}.zip"
    with tempfile.TemporaryDirectory(prefix=".download-", dir=models) as tmp:
        staging = Path(tmp)
        archive = staging / "model.zip"
        digest = hashlib.sha256()
        total = 0
        print(f"Downloading {name} from the official Vosk model server…", flush=True)
        request = urllib.request.Request(url, headers={"User-Agent": "MorseTalk-model-setup/0.1"})
        with urllib.request.urlopen(request, timeout=45) as response, archive.open("xb") as out:
            if not response.geturl().startswith("https://alphacephei.com/vosk/models/"):
                raise ValueError("Unexpected download redirect")
            while chunk := response.read(65536):
                total += len(chunk)
                if total > MAX_ARCHIVE:
                    raise ValueError("Model download exceeded the size limit")
                digest.update(chunk)
                out.write(chunk)
        sha = digest.hexdigest()
        if expected_hash is not None and sha.lower() != expected_hash.lower():
            raise ValueError("SHA256 mismatch: model not installed")
        safe_extract(archive, staging, name)
        model = staging / name
        if not (model / "am" / "final.mdl").is_file() or not (model / "conf" / "model.conf").is_file():
            raise ValueError("Expected Vosk files are missing")
        manifest = {"name": name, "source": url, "sha256": sha, "bytes": total, "license": "Apache-2.0 (per official Vosk model catalog)", "publisher_hash_verified": expected_hash is not None}
        (model / "MorseTalk-source.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        model.rename(target)
    print(f"Installed: {target}\nSHA256: {sha}\nRestart MorseTalk; no network is needed for recognition.")
    return target


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--language", choices=MODELS, default="ja-JP")
    p.add_argument("--sha256")
    args = p.parse_args()
    try:
        download(args.language, args.sha256)
    except Exception as exc:
        raise SystemExit(f"Model setup failed: {exc}") from exc


if __name__ == "__main__":
    main()
