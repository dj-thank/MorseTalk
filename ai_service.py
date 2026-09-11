"""Explicit local-LLM adapter. No model download, cloud fallback, tools, or shell execution.
Endpoint configuration is trusted server-side configuration, never a URL from received audio.
"""
from __future__ import annotations
import ipaddress
import json
import os
import threading
import urllib.error
import urllib.parse
import urllib.request

MAX_REQUEST = 32768
MAX_RESPONSE = 131072

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('AIエンドポイントのリダイレクトは禁止しています。')

def validate_endpoint(url: str, allow_remote: bool = False) -> tuple[str, bool]:
    if not isinstance(url, str) or len(url) > 2048:
        raise ValueError('AI URLが不正です。')
    parsed = urllib.parse.urlsplit(url)
    if parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment:
        raise ValueError('AI URLには認証情報・クエリ・フラグメントを含められません。')
    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError('AIポートが不正です。') from exc
    # Literal loopback only: no implicit proxy or DNS-based localhost trust.
    try:
        local = ipaddress.ip_address(parsed.hostname or '').is_loopback
    except ValueError:
        local = False
    if port is not None and not 1 <= port <= 65535:
        raise ValueError('AIポートが不正です。')
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise ValueError('AI URLにはhttp / httpsを使ってください。')
    if not local and (not allow_remote or parsed.scheme != 'https'):
        raise ValueError('既定ではループバックのAIだけ利用できます。外部利用はHTTPSとMORSETALK_AI_ALLOW_REMOTE=1が必要です。')
    return url, not local

def validate_chat(data: dict) -> tuple[list[dict], str]:
    if not isinstance(data, dict) or data.get('consent') is not True:
        raise ValueError('AIへ会話文を渡すことへの明示的な許可が必要です。')
    model = data.get('model', '')
    if not isinstance(model, str) or len(model) > 120 or any(ord(c) < 32 for c in model):
        raise ValueError('モデル名が不正です。')
    messages = data.get('messages')
    if not isinstance(messages, list) or not 1 <= len(messages) <= 25:
        raise ValueError('会話履歴は1〜25件です。')
    cleaned = []
    for i, message in enumerate(messages):
        if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant'):
            raise ValueError('会話ロールが不正です。')
        if message['role'] == 'system' and i != 0:
            raise ValueError('systemは先頭だけです。')
        content = message.get('content')
        if not isinstance(content, str) or not content.strip() or len(content.encode('utf-8')) > 8000:
            raise ValueError('会話本文が不正です。')
        cleaned.append({'role': message['role'], 'content': content})
    if sum(len(m['content'].encode('utf-8')) for m in cleaned) > 24000:
        raise ValueError('AI履歴が長すぎます。')
    return cleaned, model

class AIService:
    def __init__(self, endpoint: str | None = None, provider: str | None = None, model: str | None = None, *, allow_remote: bool | None = None):
        self.provider = provider or os.environ.get('MORSETALK_AI_PROVIDER', 'ollama')
        if self.provider not in ('ollama', 'compatible'):
            raise ValueError('AI providerはollama / compatibleです。')
        default = 'http://127.0.0.1:11434/api/chat' if self.provider == 'ollama' else 'http://127.0.0.1:8080/v1/chat/completions'
        self.endpoint, self.remote = validate_endpoint(endpoint or os.environ.get('MORSETALK_AI_URL', default), allow_remote if allow_remote is not None else os.environ.get('MORSETALK_AI_ALLOW_REMOTE') == '1')
        self.model = model if model is not None else os.environ.get('MORSETALK_AI_MODEL', '')
        self.lock = threading.Lock()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def capabilities(self):
        return {'provider': self.provider, 'endpoint': self.endpoint, 'model': self.model, 'remote': self.remote, 'verifiedRunning': False, 'description': '設定先です。モデルの稼働・品質は実際の接続テストで確認してください。'}
    def chat(self, data: dict) -> dict:
        messages, model = validate_chat(data)
        model = model or self.model
        if not model:
            raise ValueError('導入済みAIモデル名を入力してください。自動ダウンロードは行いません。')
        if not self.lock.acquire(blocking=False):
            raise BlockingIOError('AIが処理中です。重複生成は開始しません。')
        try:
            if self.provider == 'ollama':
                payload = {'model': model, 'messages': messages, 'stream': False, 'think': False, 'keep_alive': '10m', 'options': {'num_predict': 96, 'num_ctx': 4096, 'temperature': .3}}
            else:
                payload = {'model': model, 'messages': messages, 'stream': False, 'max_tokens': 96, 'temperature': .3}
            request = urllib.request.Request(self.endpoint, data=json.dumps(payload, ensure_ascii=False).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
            try:
                with self.opener.open(request, timeout=90) as response:
                    raw = response.read(MAX_RESPONSE + 1)
            except urllib.error.HTTPError as exc:
                raise RuntimeError(f'AIサーバーがHTTP {exc.code}を返しました。URL・モデル名・対応APIを確認してください。') from exc
            except urllib.error.URLError as exc:
                raise RuntimeError('AIに接続できません。設定先でOllama / llama.cppなどを起動してください。') from exc
            if len(raw) > MAX_RESPONSE:
                raise ValueError('AI応答サイズが上限を超えています。')
            result = json.loads(raw)
            if self.provider == 'ollama':
                text = result.get('message', {}).get('content')
            else:
                choices = result.get('choices', [])
                text = choices[0].get('message', {}).get('content') if choices else None
            if not isinstance(text, str) or not text.strip():
                raise ValueError('AIが有効な文章を返しませんでした。ツール呼び出しは実行しません。')
            if len(text.encode('utf-8')) > 8192:
                raise ValueError('AI文章が長すぎます。')
            return {'text': text.strip(), 'provider': self.provider, 'model': model, 'remote': self.remote}
        finally:
            self.lock.release()
