# 0.3.0 Gemma 4 E2B 更新

Androidは端末内LiteRT-LM、WindowsはOllama gemma4:e2b-it-qatです。現在の導入・ビルド手順は `GEMMA4-E2B.md` を参照してください。
以下は0.2.2の過去の記録です。古いモデル・実行番号・APKハッシュをGemma版に適用しないでください。

---

# AI接続・2台での検証手順

## 1. 信号と推論を分ける

通信の本線は `AI A → MT2音 → マイク復号 → AI B` です。各端末が文章生成のために使うAI APIは別の接続です。同じPC上のモデルを2つの端末から利用しても、会話本文の端末間配送を音以外へ切り替える実装ではありません。ただし推論サーバー自体は双方の入力を見るので、独立した2つのAIサーバーという証明にはなりません。

## 2. モデルの準備

既に動作するOllamaまたはllama.cpp互換サーバーが必要です。モデルは未同梱。モデルごとのライセンス、必要なRAM/VRAM、日本語性能を確認してください。小さいモデルでも必ず速い／自然に会話できるとは保証しません。

Ollama使用時は `ollama list` でモデル名を確認します。完全ローカルなら `OLLAMA_NO_CLOUD=1` をOllamaプロセスへ反映して再起動してください。APIの既定URLは `http://127.0.0.1:11434/api/chat` です。

Windowsアプリを `Start-AI-Windows.cmd` で開き、モデル名を入力、送信許可を確認し、「AI接続テスト」を押します。ローカルサーバーの起動コンソールは閉じないでください。

互換APIはREADMEの `MORSETALK_AI_PROVIDER` / `MORSETALK_AI_URL` / `MORSETALK_AI_MODEL` で設定します。インターネット接続が不要な構成でまず試してください。モデルのthinkingオプションなどの対応が異なる場合、接続テストのエラーを確認します。OpenAIのResponses API専用モデルをこのChat Completions互換アダプターへ直接接続する実装ではありません。

## 3. AndroidからWindows AIをUSBで使う開発用手順

Android SDK Platform Toolsが導入済みで、端末所有者がUSBデバッグ接続を承認した開発端末向けです。Android APKはAPI 35エミュレーターでビルド・インストール・Java経由の実AI接続・受信開始／停止を検証しています。物理端末の検証とは区別してください。

PC側ではAIサーバーを127.0.0.1:11434だけに待ち受けさせます。端末の番号は実際の `adb devices` 結果に置き換えます。

```sh
adb devices
adb -s DEVICE_SERIAL reverse tcp:11434 tcp:11434
```

AndroidアプリのAPI方式をOllama、エンドポイントを次に設定します。

```text
http://127.0.0.1:11434/api/chat
```

2台のAndroidをつなぐなら、それぞれのDEVICE_SERIALに対してreverseを設定します。不要になったら転送を解除し、USBデバッグ承認も必要に応じて見直してください。

```sh
adb -s DEVICE_SERIAL reverse --remove tcp:11434
```

このためにAIサーバーを0.0.0.0へ公開する必要はありません。Wi-Fi単体でPCのプライベートIPへ平文HTTP接続するUIは意図的に許可していません。別途設定したTLS検証可能なHTTPS、または端末内推論サーバーを使います。TLS検証の無効化・任意のCA自動導入・APIキー管理は実装していません。

## 4. 検証の順序

**数値経路**：自己診断→AI接続テスト→「実AI×2 · PCM仮想経路」。最後のボタンは実際の設定済みAIを最大8ターン呼びますが、PCMを実時間再生するものではありません。

**実物の2台**：機器を固定し、他の音声を止め、両端120 WPM・同じ通信コード・同じセッションにします。A/Bを分け、B受信待機→A受信待機→A開始。1,200 WPMは実験用です。低い音量から調整し、耳元で再生しないでください。音量を上げても反響による破損が改善するとは限りません。

記録する項目は、端末型番／OS／ブラウザ・WebView版、距離、置き方、音量、速度、試行数、完全一致、再送数、AI生成時間、ACKまでの時間、ターン全体の実時間です。各速度を同条件で比較します。Bluetooth、会議アプリの音声処理、スピーカーの音響特性も別の条件として扱ってください。

CRCエラーや受信確認なしで停止した場合は、両端停止→速度を下げる→新しいセッション番号を両端へ設定→再開します。自動速度交渉、周波数探索、前方誤り訂正は今回未実装です。

## 参照した一次資料

- Ollama Chat API: https://docs.ollama.com/api/chat
- Ollama FAQ（ローカル／クラウド設定と既定ポート）: https://docs.ollama.com/faq
- llama.cpp server: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- Android ADB: https://developer.android.com/tools/adb
- Android Network Security Configuration: https://developer.android.com/privacy-and-security/security-config

資料確認日：2026-09-11。手元での推論性能や実機疎通は、資料の存在によって保証されません。
