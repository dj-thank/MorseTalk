#!/usr/bin/env python3
"""Local-only UI + optional offline ASR. No dependencies for serving the app.

Voice recognition uses a locally installed Vosk model, or Windows System.Speech.
The server never downloads models or sends audio to external services.
"""
from __future__ import annotations
import argparse
import importlib.util
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import wave
import webbrowser
from ai_service import AIService, MAX_REQUEST
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent
APP = ROOT / "app"
MODELS = {"ja-JP": "vosk-model-small-ja-0.22", "en-US": "vosk-model-small-en-us-0.15"}
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json"}
CSP = "default-src 'self'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
MAX_AUDIO_BYTES = 700_000


def validated_pcm(body: bytes) -> tuple[bytes, int]:
    """Accept only bounded 16 kHz mono PCM16 audio made by the recorder."""
    if not 44 <= len(body) <= MAX_AUDIO_BYTES:
        raise ValueError("録音サイズが不正です。最大20秒にしてください。")
    if (body[:4] != b"RIFF" or body[8:16] != b"WAVEfmt " or body[36:40] != b"data"
            or int.from_bytes(body[4:8], "little") + 8 != len(body)
            or int.from_bytes(body[16:20], "little") != 16
            or int.from_bytes(body[28:32], "little") != 32000
            or int.from_bytes(body[32:34], "little") != 2
            or int.from_bytes(body[40:44], "little") != len(body) - 44):
        raise ValueError("録音ヘッダーが不正です。アプリで録音し直してください。")
    try:
        with wave.open(io.BytesIO(body), "rb") as wav:
            rate = wav.getframerate()
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2 or rate != 16000 or wav.getcomptype() != "NONE":
                raise ValueError("音声認識には16 kHz・モノラル・16 bit PCM WAVを使ってください。")
            count = wav.getnframes()
            if not 2400 <= count <= 336000:
                raise ValueError("録音は0.15〜20秒にしてください。")
            pcm = wav.readframes(count)
            if len(pcm) != count * 2:
                raise ValueError("録音ファイルが途中で切れています。")
            return pcm, rate
    except (wave.Error, EOFError) as exc:
        raise ValueError("正しいPCM WAVではありません。") from exc


class SpeechService:
    def __init__(self, model_dir: Path | None = None):
        self.model_dir = (model_dir or ROOT / "models").resolve()
        self.lock = threading.Lock()
        self.models: dict[str, object] = {}
        self.vosk_available = importlib.util.find_spec("vosk") is not None
        self.sapi_languages: list[str] = []
        if sys.platform == "win32":
            try:
                result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "windows" / "speech-capabilities.ps1")], capture_output=True, timeout=15, check=True)
                data = json.loads(result.stdout.decode("utf-8-sig"))
                self.sapi_languages = data.get("languages", [])
            except (OSError, subprocess.SubprocessError, ValueError):
                pass

    def model_path(self, language: str) -> Path:
        return self.model_dir / MODELS[language]

    def vosk_languages(self) -> list[str]:
        return [lang for lang in MODELS if self.vosk_available and (self.model_path(lang) / "am" / "final.mdl").is_file()]

    def capabilities(self) -> dict:
        langs = sorted(set(self.vosk_languages() + self.sapi_languages))
        return {"platform": "windows" if sys.platform == "win32" else "desktop", "offlineSpeech": bool(langs), "languages": langs, "description": f"端末内の音声認識：{', '.join(langs)}。録音は外部送信しません。" if langs else "音声認識モデルは未導入です。Windowsの音声言語を追加するか、Setup-Offline-Speech.cmdで無料のVoskモデルを導入してください。文字入力・モールス送受信は利用できます。"}

    def transcribe(self, body: bytes, language: str) -> str:
        if language not in MODELS:
            raise ValueError("音声の言語はja-JPまたはen-USを指定してください。")
        pcm, rate = validated_pcm(body)
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError("他の音声を認識しています。完了してから再試行してください。")
        try:
            if language in self.vosk_languages():
                from vosk import Model, KaldiRecognizer, SetLogLevel
                SetLogLevel(-1)
                if language not in self.models:
                    self.models[language] = Model(str(self.model_path(language)))
                recognizer = KaldiRecognizer(self.models[language], rate)
                parts: list[str] = []
                for start in range(0, len(pcm), 8000):
                    if recognizer.AcceptWaveform(pcm[start : start + 8000]):
                        parts.append(json.loads(recognizer.Result()).get("text", ""))
                parts.append(json.loads(recognizer.FinalResult()).get("text", ""))
                return " ".join(part.strip() for part in parts if part.strip())
            if sys.platform == "win32" and language in self.sapi_languages:
                fd, name = tempfile.mkstemp(prefix="morsetalk-", suffix=".wav")
                try:
                    with os.fdopen(fd, "wb") as handle:
                        handle.write(body)
                    result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "windows" / "recognize.ps1"), "-WavePath", name, "-Language", language], capture_output=True, timeout=45)
                    data = json.loads(result.stdout.decode("utf-8-sig"))
                    if result.returncode or "error" in data:
                        raise RuntimeError(data.get("error", "Windowsの音声認識に失敗しました。"))
                    return data.get("text", "")
                finally:
                    Path(name).unlink(missing_ok=True)
            raise RuntimeError("この言語のオフライン音声認識がありません。Setup-Offline-Speech.cmdでモデルを導入し、アプリを再起動してください。")
        finally:
            self.lock.release()


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False
    request_queue_size = 8

    def __init__(self, port=8765, service: SpeechService | None = None):
        self.token = secrets.token_urlsafe(32)
        self.speech = service or SpeechService()
        self.ai = AIService()
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = f"http://127.0.0.1:{self.server_port}"

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


class Handler(BaseHTTPRequestHandler):
    server: LocalServer
    protocol_version = "HTTP/1.1"
    server_version = "MorseTalk/0.2"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, fmt, *args):
        # No transcript, request body or sensitive query data are logged.
        pass

    def respond(self, status: int, body: bytes, content_type="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass
        self.close_connection = True

    def json_response(self, status: int, data: dict):
        self.respond(status, json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def validate_request(self, *, api=False, post=False) -> bool:
        expected_host = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get_all("Host") != [expected_host]:
            self.json_response(403, {"error": "Host not allowed"})
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.json_response(403, {"error": "Cross-site request blocked"})
            return False
        if api:
            tokens = self.headers.get_all("X-MorseTalk-Token") or []
            if len(tokens) != 1 or not secrets.compare_digest(tokens[0], self.server.token):
                self.json_response(403, {"error": "アプリを再読み込みしてください（ローカルトークン不一致）。"})
                return False
        if post and self.headers.get_all("Origin") != [self.server.origin]:
            self.json_response(403, {"error": "Origin not allowed"})
            return False
        return True

    def do_GET(self):
        if not self.validate_request():
            return
        path = urllib.parse.urlsplit(self.path).path
        if path == "/api/ai/capabilities":
            if self.validate_request(api=True):
                self.json_response(200, self.server.ai.capabilities())
            return
        if path == "/api/capabilities":
            if self.validate_request(api=True):
                self.json_response(200, self.server.speech.capabilities())
            return
        try:
            decoded = urllib.parse.unquote(path, errors="strict")
            if "\x00" in decoded or "\\" in decoded or ".." in decoded.split("/") or len(decoded) > 2048:
                raise ValueError("invalid path")
            relative = "index.html" if decoded == "/" else decoded.lstrip("/")
            target = (APP / relative).resolve()
            if not target.is_relative_to(APP.resolve()) or not target.is_file() or target.suffix not in MIME:
                self.json_response(404, {"error": "Not found"})
                return
            data = target.read_bytes()
            if target.suffix == ".html":
                data = data.replace(b"__MORSETALK_TOKEN__", self.server.token.encode("ascii"))
            self.respond(200, data, MIME[target.suffix])
        except (ValueError, UnicodeError, OSError):
            self.json_response(400, {"error": "Invalid path"})

    def do_POST(self):
        if not self.validate_request(api=True, post=True):
            return
        uri = urllib.parse.urlsplit(self.path)
        if uri.path == "/api/ai/chat":
            self.ai_post()
            return
        if uri.path != "/api/transcribe":
            self.json_response(404, {"error": "Not found"})
            return
        lengths = self.headers.get_all("Content-Length") or []
        if len(lengths) != 1 or self.headers.get("Transfer-Encoding"):
            self.json_response(411, {"error": "One Content-Length is required"})
            return
        try:
            length = int(lengths[0])
        except ValueError:
            length = -1
        if not 44 <= length <= MAX_AUDIO_BYTES:
            self.json_response(413, {"error": "録音は最大20秒です。"})
            return
        if self.headers.get_content_type() != "audio/wav":
            self.json_response(415, {"error": "audio/wav required"})
            return
        language_values = urllib.parse.parse_qs(uri.query).get("language", ["ja-JP"])
        if len(language_values) != 1:
            self.json_response(400, {"error": "One language is required"})
            return
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("録音データが途中で切れています。")
            text = self.server.speech.transcribe(body, language_values[0])
            self.json_response(200, {"text": text, "offline": True})
        except BlockingIOError as error:
            self.json_response(409, {"error": str(error)})
        except (ValueError, UnicodeError) as error:
            self.json_response(400, {"error": str(error)})
        except (TimeoutError, subprocess.TimeoutExpired):
            self.json_response(504, {"error": "音声認識がタイムアウトしました。"})
        except Exception as error:
            self.json_response(503, {"error": str(error)[:500]})


    def ai_post(self):
        lengths = self.headers.get_all("Content-Length") or []
        if len(lengths) != 1 or self.headers.get("Transfer-Encoding"):
            self.json_response(411, {"error": "One Content-Length is required"})
            return
        try:
            length = int(lengths[0])
        except ValueError:
            length = -1
        if not 2 <= length <= MAX_REQUEST:
            self.json_response(413, {"error": "AI request too large or empty"})
            return
        if self.headers.get_content_type() != "application/json":
            self.json_response(415, {"error": "application/json required"})
            return
        try:
            body = self.rfile.read(length)
            if len(body) != length:
                raise ValueError("AI request truncated")
            self.json_response(200, self.server.ai.chat(json.loads(body)))
        except BlockingIOError as error:
            self.json_response(409, {"error": str(error)})
        except (ValueError, UnicodeError) as error:
            self.json_response(400, {"error": str(error)[:500]})
        except TimeoutError:
            self.json_response(504, {"error": "AIがタイムアウトしました。"})
        except Exception as error:
            self.json_response(503, {"error": str(error)[:500]})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--ai", action="store_true", help="Open the AI Morse page")
    parser.add_argument("--model-dir", type=Path)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("port must be 0..65535")
    try:
        server = LocalServer(args.port, SpeechService(args.model_dir))
    except OSError as error:
        raise SystemExit(f"起動できません：{error}\n別のポートで試すには python server.py --port 8766") from error
    print(f"MorseTalk: {server.origin}/\n外部公開していません。終了するには Ctrl+C。", flush=True)
    if not args.no_browser:
        webbrowser.open(server.origin + ("/ai.html" if args.ai else "/"))
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
