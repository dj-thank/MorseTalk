# MorseTalk 0.3.0 / Gemma 4 E2B

Androidの既定はLiteRT-LM 0.17.0による端末内推論です。APKにランタイムを含み、モデルの重みは含みません。失敗時のクラウド・別モデル・HTTPへの自動切替はありません。
WindowsはローカルOllama `gemma4:e2b-it-qat` が既定です。Androidのファイルとは形式・量子化が異なります。

## Androidで開始

Googleの案内先から `gemma-4-E2B-it.litertlm` を取得してください。GGUFは取り込めません。
https://developers.google.com/edge/litert-lm/models/gemma-4
https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm

「モデルを取り込む」で選択→CPUとAI処理許可を確認→「先に読み込む」→「AI接続テスト」の順です。
「実AI×2 · PCM仮想経路」は実モデル2役の文章をPCM化・復号しますが、実時間の再生や物理通信ではありません。
CPUは2スレッド、GPUは明示的に選択する実験設定です。64bit arm64-v8a / x86_64を対象とします。
モデル約2.59GBをアプリ専用領域へコピーするため、ダウンロード済み元ファイルとコピー両方の空き容量が必要です。
1MiBずつコピーし、失敗・中断で既存モデルを不完全なファイルに置き換えません。表示SHA-256は手動取り込みでは配布元との自動照合ではありません。
CI用ダウンローダーはリビジョン・LFS SHA-256・サイズを検証します。アプリ削除で専用領域のモデルも消えます。

## 高速化と停止

Engineをロードしたまま再利用し、履歴が完全一致してuser文が1件増えた場合だけConversationのKVキャッシュを使い回します。
追加の思考生成・自動ツールは無効。最大96トークンと送信180UTF-8バイトの既定上限を分けて検査し、文を勝手に切りません。
maxNumTokensを上書きせずモデル指定のキャッシュ設定を維持します。MTPは無条件に有効化していません。
停止・画面非表示で生成と通信をキャンセルし、遅れた結果は送信しません。ネイティブ初期化を安全でない強制終了はせず、戻った時点で結果を捨てエンジンを解放します。その間の新規処理は拒否します。
「モデルを解放」はRAM解放でありファイル削除ではありません。

## Windows

Gemma4対応Ollamaへ `OLLAMA_NO_CLOUD=1` を反映し、`ollama pull gemma4:e2b-it-qat` を実行します。
Python3.10以降で `Start-AI-Windows.cmd` を開きます。APIは127.0.0.1:11434/api/chat。Ollama用モデル約4.3GBは別途取得します。
従来の翻訳画面は `Start-Windows.cmd` です。

## 2台で会話

通信コード・セッション・速度を一致させ、A/Bを分け、B待機→A待機→Aから開始します。物理端末は120WPMから成功率を確認し、安定時のみ上げます。1200WPMは実験用です。
通信コードとCRCは暗号化や本人認証ではありません。秘密情報や緊急用途には使わないでください。

## 再現方法と限界

JDK17 / SDK35 / Gradle8.11.1 / AGP8.9.2 / Kotlin2.4.10でビルドします。LiteRT-LM0.17のKotlinメタデータに合わせ、互換性検査は無効化していません。
`cd android && gradle assembleDebug assembleDebugAndroidTest lintDebug`
`node --test tests/*.test.mjs`
`python -m unittest discover -s tests -p 'test_*.py' -v`
`docker build -t morsetalk-test . && docker run --rm morsetalk-test`
実Gemma音声: `bash tools/start_ci_model.sh` → `python tools/test_real_ai.py`。
Android端末内: `python tools/download_gemma4.py` → 起動済みエミュレーターで `bash tools/android_local_gemma.sh`。
各Actionsの結果とモデル・対象コミット・証跡を確認してください。検証スクリプトの存在だけでは成功を意味しません。
旧Qwenの測定値はGemmaの性能ではありません。数値PCM、実時間仮想音声、エミュレーター、実機の空気中通信を区別します。
物理2台の距離・反響・雑音、GPU・Pixel9aの速度、実機ASR/TTSは未検証です。
デバッグ署名APKです。別CI実行の署名が異なり上書きできない場合、旧版削除は履歴とモデルを消すため事前に書き出してください。ストア署名は含みません。
