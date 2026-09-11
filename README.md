# MorseTalk 0.2.2

Windows / Android 向けの音声 ↔ モールス、および **AI ↔ 音響モールス ↔ AI** アプリです。
MT2 は UTF-8 を可逆圧縮・CRC付きで欧文モールスへ変換する機械間モードです。
通常の和文・欧文モールスを使う翻訳画面も残しています。

## Androidで起動

GitHub Actions の **MorseTalk build and real verification** → **MorseTalk-installable-debug-APK** を取得してください。
ZIP内の `android/app/build/outputs/apk/debug/app-debug.apk` がインストール対象です。
同梱のSHA-256と `source-commit.txt` で対象ソースを照合できます。

Android 8.0以上を対象とするデバッグ署名APKです。CIでの実行検証環境はAndroid 15（API 35）のエミュレーターです。
異なるCI実行のAPKはデバッグ署名鍵が異なる場合があり、その場合は上書きインストールできません。
アンインストールするとローカル履歴が失われるため、必要な履歴は先に書き出してください。
本番配布用の署名鍵・ストア公開設定は含みません。

**AIモデル・AIサーバーはAPKに同梱していません。**
文字からモールスへの変換と通信自己診断はAIなしで使えます。
AI自動会話は、明示的に接続したOllama / Chat Completions互換サーバーを利用します。
Android単体でモデルランタイムを自動インストールする機能はありません。
PC上のモデルを使う開発用接続は `docs/AI-SETUP.md` を参照してください。

## Windowsで起動

Python 3.10以降を用意し、`Start-AI-Windows.cmd` を実行します。
従来の音声・モールス翻訳画面は `Start-Windows.cmd` です。
起動コンソールを閉じるとローカルサーバーが停止します。
AI会話には導入済みのモデルが必要です。モデル名を入力し、AIへ会話文を送る許可を確認して「AI接続テスト」を押してください。

既定のAI接続先は `http://127.0.0.1:11434/api/chat`。
変更する場合は、起動前に以下の環境変数を設定します。

- `MORSETALK_AI_PROVIDER`: `ollama` または `compatible`
- `MORSETALK_AI_URL`: AIサーバーのチャットAPI URL
- `MORSETALK_AI_MODEL`: 導入済みモデル名

外部AIへの送信は既定では無効です。設定とセキュリティ上の注意は `docs/AI-SETUP.md` に記載しています。

## 2台で会話

両端で通信コード、セッション、速度、周波数を一致させ、片方をA・もう片方をBにします。
Bを受信待機 → Aを受信待機 → Aから会話開始、の順で操作します。
自分の送信中は復号をミュートし、応答は交互に送ります。
120 WPMから確認し、受信が安定した場合に速度を上げてください。1,200 WPMは実験用です。

文章の端末間配送は音響経路です。各端末とAIサーバーとの接続は別です。
同じAIサーバーを2端末から使う構成では、そのAIサーバーは両方の入力を受け取ります。

## 再現可能な検証

```bash
node scripts/build.mjs
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
docker build -t morsetalk-test .
docker run --rm morsetalk-test
```

実際のChromium、WAV入力の仮想マイク、AudioWorklet:

```bash
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium
python tools/test_ui.py
python tools/test_fast_browser.py
```

実LLMと実時間の音声描画経路（物理的な空気中通信ではありません）:

```bash
export MORSETALK_AI_MODEL=qwen2.5:0.5b
bash tools/start_ci_model.sh
python tools/test_real_ai.py
docker rm -f morsetalk-ollama
```

モデル取得に失敗した場合は最大3回再試行し、全失敗時は検証を失敗させます。
代替応答で成功扱いにはしません。モデル本体やDockerイメージは実行時に取得します。
`tools/test_audio_pair.py` は同じ実時間音声経路に明示的なAIテストダブルを使う、別の制御テストです。

Androidをソースからビルドする場合はJDK17 / Android SDK35 / Gradle8.11.1を用意し、
`cd android && gradle assembleDebug assembleDebugAndroidTest` を実行します。
`tools/android_smoke.sh` は起動済みエミュレーターにAPKをインストールし、実際のWebView、
AudioWorklet、Java→実LLM接続、受信開始・停止を検証します。
Windowsランチャーの検証は `windows/smoke-test.ps1` です。

## 検証範囲と限界

検証記録は `docs/VERIFICATION-2026-09-11.md` と各Actionsの成果物を参照してください。
実機2台の室内スピーカー・マイク間通信、実機音声認識・読み上げ品質は未検証です。
120〜1,200 WPMは符号速度であり、AI推論・ACK・再送を含む会話速度の保証ではありません。
MT1とMT2は別方式です。通信コードとCRCは暗号化・認証ではありません。
秘密情報や確実な到達を要する緊急通信には使わないでください。

アプリソースはMITライセンス。モデル・SDK等は `THIRD_PARTY_NOTICES.md` を参照してください。
