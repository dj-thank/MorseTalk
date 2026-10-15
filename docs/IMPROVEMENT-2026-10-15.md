# Signal / Monitor 改善と検証 — 2026-10-15

対象の開始点は main `22d4304`。Android Signalの原要件は `ANDROID-SIGNAL.md`、Monitorは `MONITOR.md`、旧AI Linkは `PC-ANDROID-0.5.1.md` に従う。今回の変更は未リリース。

## 修正した問題

- **接続準備中の二重開始・停止競合**: 開始直後に設定を固定し、停止を有効化。停止で接続待ちも解放する。旧接続・旧マイク・旧AIの結果は、新しい会話へ反映しない。
- **終わらない接続待ち**: 読み変換用WebSocketに6秒の期限を設定。接続／読み変換の失敗を説明し、同じ開始ボタンから再試行できる。
- **背景移動**: ネイティブのpauseに加え、visibilitychangeでもマイク・送信・推論を停止する。
- **初期案内**: A/Bの操作順、PC推論が必要なこと、接続手順、空の会話欄、状態ごとの次の操作を表示する。Bの開始ボタンは「Aの開始を待つ」。操作領域を44px以上にし、360px幅では開始ボタンを独立した行に配置。
- **PCでSignalが壊れて表示される**: Pythonサーバーが配信していなかった `/monitor/` と `/app/core/` をAndroidと同じ配置で解決。アクセス範囲・パストラバーサル防止・既存CSPは維持。Signalの音響会話自体はAndroid専用であり、PCにはAI Linkへの案内を表示する。
- **余分な音声生成**: ACK待機時間と送信文字の表示タイミングをセグメントだけから算出。20 WPMのACKでは完成PCMだけで約4.82 MiB相当の不要な配列生成を回避する（26.33秒 × 48,000 Hz × 4 bytes。中間配列は除外）。実際に再生するPCMの波形・位相・丸めは従来どおり。受信文の表記変換も1回の結果を各表示で共有する。
- **Monitorの遅延開始**: 音声準備中に停止した場合、後からWebSocketを開かない。古い接続の終了イベントで新会話を停止しない。
- **読み変換サーバー**: 不正JSONを無視し、起動失敗・不正出力・処理タイムアウトはリクエスト単位で返す。次の要求も同じ接続で受け付ける。

## 検証

2026-10-15、Mac / Node 24 / Python 3.14 / Playwright 1.64、隔離Python環境で実行。ブラウザは既存Chromeと公式Chromiumを使用。

| 対象 | 結果 |
|---|---|
| 修正前のSignal競合再現 | 追加した5件で不具合を再現。修正後は全件成功 |
| Node全体 | 462 / 462 成功（`node --test --test-concurrency=2 tests/*.test.mjs`） |
| Python全体 | 83件中82成功、Windows IMEの1件をプラットフォーム条件でスキップ |
| Signal実ブラウザ | 実ソースとCSSの読込、入力検証、再試行、A/B表示、接続手順、360 / 412 / 1280pxで成功 |
| Signalチャット | ACK本文、符号、パケット識別、再送、遅延変換、停止の既存回帰が成功 |
| Monitor実ブラウザ | 実ローカルWSハブに合成イベントを送り、CRC拒否・表示・停止等14項目が成功 |
| 読み変換の実接続 | 実WebSocketへ不正JSON→空文→「音楽」を送り、切断せず「おんがく」を取得 |
| 旧AI Link UI | 34項目成功。後続の会話UI10項目も専用ブラウザ導入後に成功 |
| 翻訳UI | 26項目成功。WAV往復、PCM復号、偽マイク、停止、権限拒否、4幅、Portable実行を含む |
| Portable HTML | 翻訳・AI Linkの2ファイルをビルド成功 |
| Android APK / テストAPK | `assembleDebug assembleDebugAndroidTest` 成功 |
| Android静的検査 | `lintDebug` 成功。エラー0、既存警告3件 |
| Android実WebView | API 36の専用Pixel 7エミュレーターへ本体・テストAPKをインストールし、`signal_only` の4項目すべて成功 |

Androidの警告は、バックアップの `DataExtractionRules` 未指定が1件、`LocalGemma.kt` のリソース解放が2件。後者は対象のCursorとInputStreamがどちらもKotlinの `use` ブロック内で閉じられることをソースで確認した。既存ネイティブ処理の変更や警告の抑制はしていない。

Android実WebViewの4項目は、Signal起動、空の話題の入力エラーからの復帰、接続準備中の停止、画面の収まり・実Javaブリッジ・受信AudioWorkletの読込。`MORSETALK_SMOKE_OK` とアプリが保存した `smoke-result.json` を確認した。実Gemma・物理音響・マイク入力はこの検査に含まない。専用エミュレーターの初回起動が5分の待機期限を超え、起動途中の最初のインストールも拒否されたが、起動完了を確認後にインストールし直して検査に成功した。

検証APKは `android/app/build/outputs/apk/debug/app-debug.apk`（0.6.3 debug）。ソースコミットは `5b3bbcd3acd2b2df0fa764fdfcf1dafd51fe6801`、SHA-256は `272e648ae4006de147ecce1e2abe7531223286205e714127e503f1e3efede9fe`。APK内の全56個のWebアセットをソースと照合し、完全一致を確認した。後続コミットの検証記録・生成キャッシュ除外はAPKの内容に影響しない。

旧AI Linkの34項目は成功後、後続の会話UI検証が専用ブラウザ未導入で停止したため、公式Playwrightブラウザを導入して後続のみ再実行した。後続の会話UI10項目は成功した。

初回の並列Node実行ではホスト負荷下で既存の短いACK待機と15秒の子プロセス期限に抵触。全体の同時実行数を2にし、Worklet子プロセスの検査期限を60秒へ延長した。デコード内容・速度・判定条件は変えていない。全体462件が単一実行で成功した後、表示変更の影響範囲のみ再確認した。

UIの現在のスクリーンショットはローカル `test-results/signal-ui-*.png`。手動画面確認は `test-results/improvement/`。ブラウザの私的タブ情報を含むため、これらはGit管理・公開対象にしない。全コマンドログはMacの `Development/logs/dev-runs/2026-10-15/` に保存している。

主な完了ログ: Node `run-2o1i_5d6.log`、Python `run-t0o54r9u.log`、Signal UI `run-_y_tahx_.log`、Monitor `run-br00v4k3.log`、翻訳UI `run-vt7j4eij.log`、Android APK・テストAPK・lint `run-n26x563g.log`、Android実WebView `run-za0j858_.log`。

## 再実行

```sh
node scripts/build.mjs
node --test --test-concurrency=2 tests/*.test.mjs
python -m pip install -r relay/requirements.txt -r requirements-monitor-reading.txt playwright
python -m playwright install chromium
python -m unittest discover -s tests -p 'test_*.py' -v
python tools/test_signal_ui.py
python tools/test_signal_chat.py
# 別ターミナルでテスト所有の monitor_server.py --no-browser --port 18790 を起動
python tools/test_monitor_ui.py
# Android SDK / Java 21 / Gradle 8.11.1を使用
.tools/gradle-8.11.1/bin/gradle -p android --daemon --build-cache --max-workers=2 assembleDebug assembleDebugAndroidTest lintDebug
# 起動済みの専用エミュレーターを明示する。今回のserialはemulator-5582。
adb -s emulator-5582 install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5582 install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb -s emulator-5582 shell am instrument -w -r -e signal_only true jp.morsetalk.app.test/jp.morsetalk.app.SmokeInstrumentation
```

新Signal UIとチャットのブラウザ検査はCIにも追加した。今回のGitHub CI実行・公開・マージはローカル検証とは別。

## 実機受入の境界

実Gemmaを使用した今回の会話、物理Android 2台の音響、Windows実機、USB抜差し、公開WSS、ASR/TTS、ストア署名は今回の検証に含めていない。過去の2026-09-13のPixel実音響記録はその時点の版と条件に対する記録であり、今回の変更後の受入に置き換えない。

アクセシビリティについては入力ラベル、状態通知、フォーカス枠、操作領域、横方向の収まりを確認した。スクリーンリーダーの実操作や適合性全体を確認したものではない。
