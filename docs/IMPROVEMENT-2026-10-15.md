# Signal / Monitor 改善と検証 — 2026-10-15

対象の開始点は main `22d4304`。Android Signalの原要件は `ANDROID-SIGNAL.md`、Monitorは `MONITOR.md`、旧AI Linkは `PC-ANDROID-0.5.1.md` に従う。今回の変更は未リリース。

## 修正した問題

- **接続準備中の二重開始・停止競合**: 開始直後に設定を固定し、停止を有効化。停止で接続待ちも解放する。旧接続・旧マイク・旧AIの結果は、新しい会話へ反映しない。
- **終わらない接続待ち**: 読み変換用WebSocketに6秒の期限を設定。接続／読み変換の失敗を説明し、同じ開始ボタンから再試行できる。
- **背景移動**: ネイティブのpauseに加え、visibilitychangeでもマイク・送信・推論を停止する。
- **初期案内**: A/Bの操作順、PC推論が必要なこと、接続手順、空の会話欄、状態ごとの次の操作を表示する。Bの開始ボタンは「Aの開始を待つ」。操作領域を44px以上にし、360px幅では開始ボタンを独立した行に配置。
- **PCでSignalが壊れて表示される**: Pythonサーバーが配信していなかった `/monitor/` と `/app/core/` をAndroidと同じ配置で解決。アクセス範囲・パストラバーサル防止・既存CSPは維持。Signalの音響会話自体はAndroid専用であり、PCにはAI Linkへの案内を表示する。
- **余分な音声生成**: ACK待機時間と送信文字の表示タイミングをセグメントだけから算出。実際に再生するPCMの波形・位相・丸めは従来どおり。受信文の表記変換も1回の結果を各表示で共有する。
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

旧AI Linkの34項目は成功後、後続の会話UI検証が専用ブラウザ未導入で停止したため、公式Playwrightブラウザを導入して後続のみ再実行した。後続の会話UI10項目は成功した。

初回の並列Node実行ではホスト負荷下で既存の短いACK待機と15秒の子プロセス期限に抵触。全体の同時実行数を2にし、Worklet子プロセスの検査期限を60秒へ延長した。デコード内容・速度・判定条件は変えていない。全体462件が単一実行で成功した後、表示変更の影響範囲のみ再確認した。

UIの現在のスクリーンショットはローカル `test-results/signal-ui-*.png`。手動画面確認は `test-results/improvement/`。ブラウザの私的タブ情報を含むため、これらはGit管理・公開対象にしない。全コマンドログはMacの `Development/logs/dev-runs/2026-10-15/` に保存している。

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
```

新Signal UIとチャットのブラウザ検査はCIにも追加した。今回のGitHub CI実行・公開・マージはローカル検証とは別。

## 実機受入の境界

実Gemmaを使用した今回の会話、物理Android 2台の音響、Windows実機、USB抜差し、公開WSS、ASR/TTS、ストア署名は今回の検証に含めていない。過去の2026-09-13のPixel実音響記録はその時点の版と条件に対する記録であり、今回の変更後の受入に置き換えない。

アクセシビリティについては入力ラベル、状態通知、フォーカス枠、操作領域、横方向の収まりを確認した。スクリーンリーダーの実操作や適合性全体を確認したものではない。
