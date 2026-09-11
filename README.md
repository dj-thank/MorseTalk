# MorseTalk 0.2.1

Windows / Android 向けの 音声 ↔ モールス、および **AI ↔ 音響モールス ↔ AI** アプリ。
MT2 は UTF-8 を可逆圧縮・CRC付きで欧文モールスへ変換する機械間モードです。
通常の和文・欧文モールスの翻訳画面も残しています。

## 実行

Windows: `Start-AI-Windows.cmd`（Python 3.10+、導入済み Ollama / llama.cpp モデルが必要）。
旧翻訳画面: `Start-Windows.cmd`。説明は `docs/AI-SETUP.md`。

Android: GitHub Actions の **MorseTalk build and real verification** → **MorseTalk-debug-apk**。
APK はビルド成功時に生成されるデバッグ署名版です。ソースからは
`python tools/build_android.py --yes` または SDK/JDK/Gradle を用意し
`cd android && gradle assembleDebug`。端末内 AI モデルは別途必要です。
開発時にPCのモデルを使う場合は `adb reverse tcp:11434 tcp:11434`。

## 検証

```bash
node scripts/build.mjs
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py' -v
docker build -t morsetalk-test .
docker run --rm morsetalk-test
```

ブラウザの実マイクAPI（合成WAV入力）と AudioWorklet:

```bash
python -m pip install playwright==1.57.0
python -m playwright install chromium
python tools/test_fast_browser.py
```

実LLM＋実時間のブラウザ音声描画経路（物理的な空気中通信ではありません）:

```bash
export MORSETALK_AI_MODEL=qwen2.5:0.5b
bash tools/start_ci_model.sh  # 明示的に実行した場合のみ無料モデルを取得
python tools/test_real_ai.py
```

`tools/android_smoke.sh` は起動済みエミュレーターにAPK・テストAPKをインストールし、
実際のWebView、AudioWorklet、Java→実LLM接続、受信開始・停止を検証します。
結果・スクリーンショット・モデル識別情報は Actions artifacts に保存します。
`tools/test_ai_ui.py` の代替応答テストと、`tools/test_real_ai.py` の実モデル検証は別物です。

## 状態と限界

コンテナ検証・CI・エミュレーター結果と、実機2台の室内音響試験を区別します。
**実機スピーカー／マイク間の高速通信、実機ASR/TTS品質は未検証です。**
120〜1,200 WPM は符号速度であり、AI生成・ACK・再送を含む会話速度の保証ではありません。
通信コードとCRCは暗号化・認証ではありません。秘密情報や緊急通信には使わないでください。

`docs/VERIFICATION-2026-09-11.md` と各 Actions 実行ログが検証記録です。
アプリソース MIT。モデル・SDK等のライセンスは別途 `THIRD_PARTY_NOTICES.md`。
