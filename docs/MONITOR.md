# Signal Monitor — トン・ツーから日本語までをリアルタイムに見せる

`monitor/` は人に見せるための可視化画面です。2台の端末（携帯／PC）が **今まさに行っている復号** を、最小単位から順に表示します。

```
トン・ツー（4,000 Hz の長さ判定） → 国際モールス1文字 → Base32 → バイト → ヘッダー → LZ展開 → UTF-8 → CRC32 → ACK
```

復元テキストは、文字が確定するたびに「ローマ字 → かな → 本文」の順で段階表示されます。ローマ字・ひらがな読みと「先読み」（文の続きの予想）は、同じPC上の **Gemma 4 E2B** が生成します。E2Bが無いときは内蔵のかな表だけで表示します。

## 仕組み

- 端末アプリ（AI Link画面）の「診断」→「デモ監視」を有効にすると、その端末は受信中のトン・ツー、確定した符号、送信する符号列、復号結果を `ws://127.0.0.1:8790/feed` へ流します。既定はオフで、接続先は 127.0.0.1 しか受け付けません。
- 携帯は `adb reverse tcp:8790 tcp:8790` で PC の 8790 番へ到達します（USB でも Wi-Fi ADB でも同じ）。
- `tools/monitor_server.py` が `monitor/` と本物のコーデック（`app/core/`）を配信し、feed を全ビューアへ配ります。ビューアは E2B への読み仮名リクエストをサーバー経由で送ります（`E2B_URL`, `E2B_MODEL` で変更可。既定は LM Studio の `http://127.0.0.1:1234/v1/chat/completions`, `gemma-4-e2b-it`）。
- 監視画面は端末を操作しません。中継サーバー（8787）とは独立で、音響モードでもUSB/オンラインモードでも同じ画面が使えます。オンライン（暗号化）モードでは音が無いので、端末が復号した符号列を同じ速度で再生して表示します。

## 使い方（Windows）

1. E2B を用意する: LM Studio に `unsloth/gemma-4-E2B-it-GGUF`（Q4_K_M）を読み込み、サーバーを 1234 番で起動する。
   ```
   lms load gemma-4-e2b-it --gpu max --context-length 4096 -y
   lms server start --port 1234
   ```
2. 監視サーバーを起動する（ブラウザが開きます）:
   ```
   Start-Monitor.cmd
   ```
3. 2台の携帯を接続する（中継 + 監視の転送 + 端末側の「デモ監視」有効化まで自動）:
   ```
   py -3 -X utf8 tools/phone_pair.py --a <A端末> --b <B端末> --speed 60 --monitor-port 8790
   ```
   スピーカー同士（音響モード）で見せる場合は、両端末で「近くの端末・音響モールス」「60 WPM」を選び、B待機→A待機の順で始めます。
4. 端末が無いときは画面右上の「デモ再生（端末なし）」で、同じコーデックによる往復を再生できます。
5. PC だけで Gemma 同士の会話を映す（端末不要、`pip install playwright && playwright install chromium` が必要）:
   ```
   set MORSETALK_AI_PROVIDER=compatible
   set MORSETALK_AI_URL=http://127.0.0.1:1234/v1/chat/completions
   set MORSETALK_AI_MODEL=gemma-4-e2b-it
   py -3 -X utf8 server.py --ai --no-browser --port 8765
   py -3 -X utf8 tools/pc_android.py --serial <どれか1台>   （127.0.0.1:8787 の中継だけを使います）
   py -3 -X utf8 tools/pc_pair_demo.py --turns 24 --speed 600 --preset daily
   ```
   `tools/monitor_record.py` は監視画面をヘッドレス Chromium で録画（WebM）し、静止画も保存します。

## 画面の見方

- **ON AIR**: 上段がA、下段がB。ブロックの長さがそのまま短点・長点の長さです。中央の大きな文字は直近の「トン」「ツー」。
- **端末A / 端末B**: 符号（今の文字）、Base32（`VV` 前置き→ヘッダー→本文→CRC の色分け）、バイト列とヘッダー解釈、復元テキスト（ローマ字／かな／本文／先読み）、検査（CRC32・ACK）。
- **会話 / 回線 / いま起きていること**: 往復の本文、速度・1短点・圧縮率・ACK往復時間・E2B応答時間、現在の処理段階。

## 制限

- E2B の読み仮名と先読みは表示用の補助であり、通信内容そのものではありません。誤読の可能性があります。
- 端末が送る監視データには復号途中の本文が含まれます。デモ以外では「デモ監視」をオフのままにしてください。
- 表示は端末からのイベントに依存します。音響モードで復号に失敗した区間は「不一致・破棄」と表示されます。
