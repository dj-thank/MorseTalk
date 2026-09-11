# MorseTalk 0.5.1 — PCとAndroidでモールス会話

PC↔Android、PC↔PC、Android↔Androidが同じMT2モールス形式を使います。
各端末で「Gemmaが自動応答」または「人が文字で応答」を選べるので、AI↔AI、手入力↔AI、手入力↔手入力の組み合わせが可能です。
会話の10話題はひな型であり、自由入力・途中の話題変更も使えます。

## 近くに置いた2台：音響

「近くの端末・音響モールス」を選び、PCに表示した設定QRをAndroid内カメラで読み込み、内容を確認して適用します。
役割をA/Bに分け、速度はまず120 WPMにします。B待機→A待機→Aから開始してください。
両方のスピーカーとマイクが必要です。ブラウザのマイク許可を確認し、耳元で大音量を再生しないでください。
物理的なPC/スマートフォンの距離・反響・雑音は未検証です。1200 WPMは実験用で、実機での成功率を保証しません。

## 同じPCとAndroid：USBで公開サーバーなし

これは所有者が承認した開発用USB接続を使います。USBケーブルだけで無設定になる機能ではありません。
AndroidのUSBデバッグを明示的に許可し、信頼できる自分のPCだけを接続してください。アプリはUSBデバッグや端末の信頼設定を勝手に変更しません。
PCにはPython 3.10以降、Python Launcher、Android SDK Platform Toolsのadb（PATHに設定）が必要です。
モデル、SDK、OSドライバーをこの起動ファイルが自動導入することはありません。

プロジェクトフォルダーで必要な中継ライブラリを一度導入します。

```powershell
py -3 -m pip install -r relay/requirements.txt
adb devices
```

AndroidにAPKをインストールして開き、PCで `Start-PC-Android.cmd` を実行します。
PCの中継を127.0.0.1だけに起動し、選んだAndroidの8787番ポートだけをADB reverseでつなぎます。
続いてPCとAndroidのアプリ画面で「パソコンとAndroidで話す」→「USBの接続先を設定」を押してください。
接続先は `ws://127.0.0.1:8787/v1`。設定ボタンだけでは通信もAIも始まりません。

PCでオンライン招待を作る→QRをAndroid内カメラで読む（またはPNG/招待文）→確認して適用→両端でネット交信を許可→B待機→A待機→Aから開始、の順です。
Androidで招待を作り、PCをBにして開始することもできます。招待を公開しないでください。

複数の端末がある場合は、表示された端末番号を明示的に指定します。

```powershell
.\Start-PC-Android.cmd --serial YOUR_DEVICE_SERIAL
```

ポートが使用中なら `--port 8788` などを指定し、両端の中継URLも同じ番号に変更してください。
既存の転送やサーバーを上書き・停止しません。無断で別の端末を選ぶこともありません。
終了は起動コンソールでCtrl+C。この起動処理が作った中継と転送だけを閉じます。
ケーブルを途中で抜くなどして解除できなかった場合、再接続後に `adb -s YOUR_DEVICE_SERIAL reverse --list` で確認してください。
その後必要な転送だけを `adb -s YOUR_DEVICE_SERIAL reverse --remove tcp:8787` で解除します。ほかの開発アプリの転送は削除しません。
USBデバッグが不要になったら端末側で無効化・承認解除も検討してください。

USBでもネット方式のMT2符号データを暗号化して送ります。音声再生はしません。公開サーバー・LANへの待受・ルーターやファイアウォール設定変更は不要です。
暗号化は相手の実名を保証せず、独立した暗号監査も未実施です。

## 離れた相手：オンラインWSS

両端でオンラインを選び、運用している `wss://.../v1` 中継を指定して招待QRを共有します。
常設の公開中継は未設置です。`relay/` のDocker/Caddy構成と `QR-ONLINE.md` の手順で管理者が設置します。
この作業でクラウド契約、DNS変更、ポート開放は実施していません。例のドメインは使えるサービスではありません。

## Gemma同士でおしゃべり

WindowsはローカルOllama `gemma4:e2b-it-qat`、Androidは取り込み済み `.litertlm` による端末内Gemma 4 E2Bを利用できます。
AndroidでHTTPのGemmaを選ぶときだけ、そのAI接続先を明示設定します。USBの交信用8787転送はAI用11434を自動転送しません。
AIを使う各端末でモデル読込・AI処理の許可を確認し、「Gemmaが自動応答」を選びます。手入力側はモデルもAI処理許可も不要です。
Aで話題と会話スタイルを選び開始します。相手の発言は同じモールス通信経路で届いたものだけを次のAIへ渡します。
既定8ターンには最初の人間の話題共有も含みます。1台試用は数値PCMで最大8ターン、2台交信は最大32ターンです。
言語混入・空文・反復・長さの違反は同じGemmaで一度だけ生成し直し、再検査が失敗したら送らず停止します。別モデルや定型返答で埋めません。
今回は意図しない韓国語の修正を、会話の続きを生成する依頼ではなく短い日本語の編集依頼に分離しました。外国語学習として明示した韓国語は引き続き許可します。

## 実行検証の区別

`tools/test_pc_android.cjs` は実Desktop Chromiumと、インストール済みAndroid APKのWebViewを別々に接続します。
UIはブラウザが生成する操作で動かし、相手に本文を直接渡すテスト用経路はありません。招待文だけを初期共有します。
2方向の手入力、PCの人↔AndroidのGemma、Gemma同士の計4ケースを実行します。AndroidはAPI35エミュレーターであり、物理端末ではありません。
標準のCIでは両役が同じ実Ollamaサーバーを利用します。Android端末内Gemmaは別ジョブで検証します。
Windows上のブラウザ交信も別ジョブで実行します。Linux↔Androidエミュレーターの成功を物理Windows↔電話機の成功として扱いません。
各テストの実行結果・失敗・対象コミットはGitHub Actionsと `test-results/` を確認してください。テストスクリプトの存在だけでは成功を意味しません。
実機の音響通信、USB抜差し・画面ロック・回線切替、GPU/Pixel9a、実ASR/TTS、公開WSS疎通は未検証です。

## 配布時の注意

APKはデバッグ署名です。旧版と署名が異なって上書きできず削除が必要な場合、モデル・履歴も消えるので必要なデータを先に保存してください。
モデルはAPKに含まず、Androidの元ファイル約2.59 GBとアプリ内コピーの両方を置く容量が必要です。
この機能はフォアグラウンドの会話用であり、背景で常駐する通話サービスではありません。

参考（一次資料、2026-09-12確認）：
- Android WebView / adb reverse: https://developer.android.com/develop/ui/views/layout/webapps/access-local-server
- Android Debug Bridge: https://developer.android.com/tools/adb
- Playwright AndroidDevice: https://playwright.dev/docs/api/class-androiddevice
