# MorseTalk 0.5.1 — PCとAndroidで、モールス会話

Gemma 4 E2B同士、または人とAIがモールスで話すWindows / Androidアプリです。
PC↔Android・PC↔PC・Android↔Androidで同じ通信形式を使い、各端末を手入力またはAI自動応答にできます。
通常の音声↔モールス、和文・欧文の翻訳画面も残しています。

## 接続方法

| 方法 | 使い方 | 前提 |
|---|---|---|
| 音響 | モールス音をスピーカーから相手のマイクへ | 近距離。まず120 WPM。物理端末の距離/反響は未検証 |
| USB | PCのローカル中継経由で暗号化モールス符号をAndroidへ | 所有者承認済みUSBデバッグ、ADB。公開サーバー不要 |
| オンライン | WSS中継経由で暗号化モールス符号を送る | 管理者が設置した中継先。常設公開サービスは未設置 |

USB/オンラインは音声配信ではなく、点・線の符号データを運びます。マイクも音の再生時間待ちもありません。
QRはアプリ内カメラ・PNG読込・招待文で共有でき、読み取り内容を確認してから設定を適用します。

## Android

GitHub Actionsの成功した実行から `MorseTalk-installable-debug-APK` 成果物を取得します。
ZIP内 `android/app/build/outputs/apk/debug/app-debug.apk` がアプリ本体です。テストAPKは通常の利用には不要です。
AIには別途 `gemma-4-E2B-it.litertlm` を取り込み、CPU→AI処理の許可→先読み→AI接続テストの順で準備します。
モデル本体約2.59GBはAPKに含まず、元ファイルとアプリ専用コピーの両方を置く空き容量が必要です。
手入力と通信自己診断にはモデルは不要です。端末内推論の導入は [Gemmaガイド](docs/GEMMA4-E2B.md) を参照してください。
APKはデバッグ署名です。旧版と署名が違って削除が必要な場合、モデル・履歴も消えるため先に保存してください。

## Windows

Python 3.10以降とPython Launcherを用意し、`Start-AI-Windows.cmd` を開きます。
AIにはローカルOllama `gemma4:e2b-it-qat` が必要です。設定・モデル取得は明示操作で行い、アプリは別モデルやクラウドへ自動切替しません。
従来の翻訳画面は `Start-Windows.cmd` です。起動コンソールを閉じるとサーバーも停止します。

## PC↔AndroidをUSBで試す

PCにADBを追加し、信頼する自分のPCへのUSBデバッグ接続をAndroidで承認してください。
USBケーブルだけで無設定につながる方式ではなく、開発用ADB接続を使います。

```powershell
py -3 -m pip install -r relay/requirements.txt
adb devices
.\Start-PC-Android.cmd
```

両端の画面で「パソコンとAndroidで話す」→「USBの接続先を設定」。
Aで招待作成→BがQR等で読み取り確認→両端でネット交信を許可→B待機→A待機→A開始です。
各端末でAIまたは手入力を選びます。AI側だけモデルとAI処理の許可が必要です。
終了はCtrl+C。自分で作った中継と転送だけを閉じ、既存転送・LAN/ファイアウォール・信頼設定は変更しません。
詳細・複数端末やポート指定は [PC/Androidガイド](docs/PC-ANDROID-0.5.1.md)。

## AI同士のおしゃべり

日常・音楽・料理・旅・科学・AI・語学・ゲーム・創作・哲学の10話題と4スタイルを選び、自由入力や途中の話題変更も使えます。
最初の話題もモールスで相手へ届き、以後は相手の発言を受けてGemmaが応答します。
既定8ターンには最初の人間の話題共有を含みます。AI発言は7回です。1台試用は最大8ターンの数値PCM処理、2台交信は最大32ターンです。
通信が正確でもモデルの創作・会話品質が常に良いとは保証しません。反復・空文・言語混入などは同じモデルで一度だけ修正し、再検査に失敗すれば停止します。

## 検証済みの範囲

[最終PR実行](https://github.com/dj-thank/MorseTalk/actions/runs/34636425983) は6ジョブ成功。
Node416 / Python71、画面111項目、同じAPKのAndroid通常/端末内Gemma各22項目、Windowsブラウザ、PC↔Android直接交信4ケース、実Gemmaの14会話条件を確認しました。
さらに [追加実験](https://github.com/dj-thank/MorseTalk/actions/runs/34636882308) で、PCのOllamaとAndroid内LiteRT-LMを別々に動かす交信も成功しました。
直接交信はLinuxブラウザとAndroid15エミュレーターです。Windows実行は別途検証しています。追加実験のAPKは同一アプリコードの別署名ビルドで、配布APKとの違いも記録しています。
[検証記録とAPKの出所](docs/PC-ANDROID-VERIFICATION-0.5.1.md) に成功・途中の失敗・全実測・制限を分けて記載しています。

```sh
node scripts/build.mjs
node --test tests/*.test.mjs
python -m pip install -r relay/requirements.txt
python -m unittest discover -s tests -p 'test_*.py' -v
docker build -t morsetalk-test .
docker run --rm morsetalk-test
```

ブラウザ等の再現は `.github/workflows/verification.yml` と各 `tools/test_*.py` を参照してください。
AndroidビルドはJDK17 / SDK35 / Gradle8.11.1 / AGP8.9.2 / Kotlin2.4.10 / LiteRT-LM0.17.0です。

## 未実施・注意

物理Windows↔スマートフォン、USB抜差し、空気中通信の距離・反響・雑音、公開WSS疎通、実機QR、GPU/Pixel9a、実ASR/TTS品質は未検証です。
オンラインの常設中継、ストア配布署名、モデル重みの同梱はありません。画面非表示や相手切断で停止し、自動再接続しません。
招待QRに秘密鍵が入るため相手だけに渡します。暗号化の第三者監査や実名認証は未実施で、高機密情報・緊急用途には使わないでください。
ソースはMIT、モデル/SDK等の条件は [第三者ライセンス](THIRD_PARTY_NOTICES.md) を参照してください。
