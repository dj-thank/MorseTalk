#!/usr/bin/env python3
"""Local PC<->Android USB relay. Never opens a LAN listener or changes device trust.

Requires an installed APK, Python/websockets and an owner-authorized ADB device.
Only a newly created, explicitly selected reverse mapping is removed on exit.
No model download, application install, firewall change, or cloud deployment.
"""
from __future__ import annotations
import argparse
import asyncio
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import webbrowser

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
DEFAULT_PORT = 8787


def valid_port(value: int) -> int:
    if type(value) is not int or not 1024 <= value <= 65535:
        raise ValueError('ポート番号は1024〜65535です。')
    return value


def choose_device(output: str, requested: str | None = None) -> str:
    devices = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[1] in ('device', 'offline', 'unauthorized', 'recovery', 'sideload'):
            if not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', parts[0]):
                raise ValueError('ADB端末番号を読み取れません。')
            devices[parts[0]] = parts[1]
    if requested is not None:
        if requested not in devices or devices[requested] != 'device':
            raise ValueError('指定端末は未接続、未承認、またはオフラインです。端末の所有者がUSBデバッグ接続を確認してください。')
        return requested
    # Do not silently choose a different authorized phone when multiple devices exist.
    if len(devices) != 1:
        raise ValueError('接続端末を1台にするか、--serial で端末を指定してください。確認コマンド: adb devices')
    serial, state = next(iter(devices.items()))
    if state != 'device':
        raise ValueError('端末が未承認またはオフラインです。端末側で自分のPCへのUSBデバッグ接続を確認してください。')
    return serial


@dataclass
class UsbBridge:
    adb: str
    serial: str
    port: int = DEFAULT_PORT
    owned: bool = False

    def __post_init__(self):
        valid_port(self.port)
        if not re.fullmatch(r'[A-Za-z0-9._:-]{1,160}', self.serial):
            raise ValueError('端末番号が不正です。')

    def command(self, *args: str) -> str:
        result = subprocess.run([self.adb, '-s', self.serial, *args], capture_output=True,
                                text=True, encoding='utf-8', errors='replace', timeout=15)
        if result.returncode:
            # Do not copy arbitrary stderr, which can contain host paths or serials.
            raise RuntimeError('ADB操作が失敗しました。端末の接続・承認状態を確認してください。')
        return result.stdout.strip()

    def mappings(self) -> dict[str, str]:
        result = {}
        for line in self.command('reverse', '--list').splitlines():
            parts = line.split()
            if len(parts) == 3:
                result[parts[1]] = parts[2]
        return result

    def attach(self):
        if self.owned:
            raise RuntimeError('このUSB接続は開始済みです。')
        port = f'tcp:{self.port}'
        if port in self.mappings():
            raise RuntimeError('同じ端末ポートが既に転送されています。既存転送は変更しません。別の--portを指定してください。')
        self.command('reverse', '--no-rebind', port, port)
        self.owned = True

    def detach(self):
        if not self.owned:
            return
        self.owned = False
        port = f'tcp:{self.port}'
        # Respect a mapping that an external tool replaced during this session.
        if self.mappings().get(port) == port:
            self.command('reverse', '--remove', port)


@contextmanager
def desktop_server():
    from server import LocalServer
    server = LocalServer(0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


async def run_session(bridge: UsbBridge, *, open_browser: bool = True, stop_event=None):
    from relay.server import Relay, LOCAL_ORIGIN, process_request
    from websockets.asyncio.server import serve
    relay = Relay(max_rooms=8, max_connections=16, per_ip=16)
    # Reserve the host socket before changing any device mapping. Existing servers
    # are not reused, killed or made externally accessible.
    async with serve(relay.handler, '127.0.0.1', bridge.port,
                     origins=['https://appassets.androidplatform.net', LOCAL_ORIGIN],
                     process_request=process_request, max_size=11000, max_queue=8,
                     write_limit=16384, compression=None, server_header=None,
                     open_timeout=8, close_timeout=2, ping_interval=20, ping_timeout=20):
        try:
            bridge.attach()
            with desktop_server() as desktop:
                print(f'PC画面: {desktop.origin}/ai.html', flush=True)
                print(f'両端の中継URL: ws://127.0.0.1:{bridge.port}/v1', flush=True)
                print('PCとAndroidの画面で「USBの接続先を設定」を選択（既定8787）。\n'
                      '別ポートを指定した場合は、上の中継URLを両端に設定してください。\n'
                      'PCで招待QR作成 → Androidで読取・確認して適用 → 両端でネット交信を許可。\n'
                      'B待機 → A待機 → Aから開始。各端末で手入力／Gemmaを選べます。\n'
                      '終了はCtrl+C。この接続の中継と転送だけを閉じます。', flush=True)
                if open_browser:
                    webbrowser.open(desktop.origin + '/ai.html')
                await (stop_event.wait() if stop_event is not None else asyncio.Future())
        finally:
            try:
                bridge.detach()
            except (OSError, RuntimeError, subprocess.SubprocessError):
                print('USB転送を解除できませんでした。再接続後に対象端末の転送を確認してください。', file=sys.stderr)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', help='adb devicesに表示される所有者承認済み端末番号')
    parser.add_argument('--port', type=int, default=DEFAULT_PORT)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args(argv)
    try:
        valid_port(args.port)
        import websockets.asyncio.server  # Check before touching a device.
        adb = shutil.which('adb')
        if not adb:
            raise RuntimeError('Android SDK Platform ToolsのadbをPATHへ追加してください。SDKは自動導入しません。')
        listing = subprocess.run([adb, 'devices'], capture_output=True, text=True,
                                 encoding='utf-8', errors='replace', timeout=15, check=True).stdout
        serial = choose_device(listing, args.serial)
        asyncio.run(run_session(UsbBridge(adb, serial, args.port), open_browser=not args.no_browser))
    except KeyboardInterrupt:
        return 0
    except ImportError:
        print('必要なPythonライブラリがありません。python -m pip install -r relay/requirements.txt を実行してください。', file=sys.stderr)
        return 1
    except (ValueError, OSError, RuntimeError, subprocess.SubprocessError) as exc:
        print(f'開始できません: {exc}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
