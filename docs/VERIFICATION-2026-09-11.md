# 2026-09-11 検証記録

## このコンテナで実行済み

- 元の配布ソース: Node 287/287、Python 36/36、AI画面15項目が成功。
- Workletの依存モジュールを代替せず、TextEncoder/TextDecoder/DOMを与えずにバンドルを読み込むと、旧版は `ReferenceError: TextEncoder is not defined`。
- `app/core/utf8.mjs` を追加し、Worklet内のDOM符号化API依存を除去。
- 不正UTF-8拒否、Unicodeの可逆性、先頭BOM保持、4速度の完全Workletバンドル復号を含む新規33件を追加。
- 修正後: Node 320/320、Python 36/36が成功。

このコンテナではネットワークDNSを利用できず、Android SDKも存在しない。
管理下ChromiumはループバックURLを `ERR_BLOCKED_BY_ADMINISTRATOR` として拒否した。
これらを回避せず、実ブラウザマイクAPI・APK・エミュレーター・実LLM試験は
標準GitHub hosted runnerで実行するワークフローを追加した。

## 追加した実行検証（結果は対応するActions runを参照）

1. Docker内の全コア・サーバーテスト。
2. 通常ChromiumのgetUserMedia → 実AudioWorklet。入力は合成WAV、物理マイクではない。
3. Ollama実モデルを2役に使用し、4ターンを実時間WebAudio → 相手のWorkletで復号。
4. Windows PowerShell 5.1で起動・トークン・ローカルHTTP動作。
5. Android assembleDebug / assembleDebugAndroidTest / lintDebug、APK署名検証。
6. Android 35エミュレーターへのAPKインストール、アプリ起動、実WebView、Worklet読込、Java→実AI接続、受信開始停止。

## 未実施を成功扱いしない

実モデルがない試験は失敗終了する。過去の固定文字列の代替応答を実AIと呼ばない。
エミュレーターを実機とは呼ばない。数値PCMやWebAudio仮想経路を室内音響試験とは呼ばない。
APK生成の成功と実機間会話の成功は別判定。
