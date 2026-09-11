# Androidのビルド

## 配布時の状態

**この配布物にAPKはありません。Java/Gradleのソースは実装済みですが、Android SDKがない作成環境ではコンパイルとAndroid Lintを実行できませんでした。** 以下は実行用に用意した手順であり、ビルド成功の実測記録ではありません。Windows PowerShell経路もWindows実機では未検証です。

## 必要なもの

Android Studio、SDK Platform 35、SDK Build-Tools 35.0.0、JDK 17以降。ビルド構成をAGP 8.9.2 / Gradle 8.11.1 / Java 17に固定しています。SDKのライセンスは開発者自身で確認・承諾してください。自動的に承諾するスクリプトはありません。

`ANDROID_HOME`をSDKフォルダーに設定するか、`android/local.properties`に`sdk.dir`を設定します。Windowsでは通常のAndroid StudioのSDK/JBR位置も補助スクリプトが調べます。`local.properties`は他の端末と共有しません。

## 補助スクリプト

Windowsは `Build-Android.cmd` を実行します。Python 3.10以降とPython Launcherが必要です。macOS / Linuxは次のとおりです。

```sh
export ANDROID_HOME="$HOME/Android/Sdk"   # 自分のSDK位置に変更
export JAVA_HOME="/path/to/jdk-17"       # 自分のJDK位置に変更
./build-android.sh
```

Gradleが `.tools/` にない場合、実行確認後に公式の8.11.1バイナリーZIPと公式SHA-256サイドカーファイルをHTTPSで取得します。ハッシュを照合し、安全なパスだけ展開します。SDKやJavaのインストール、OS設定の変更、ストア公開、製品版署名はしません。

Gradleプラグインなどの初回取得もオンラインです。これらは開発環境の取得であり、会話音声を送信する処理ではありません。

```sh
python tools/build_android.py --task assembleDebug
python tools/build_android.py --task lintDebug
```

成功時の出力は `android/app/build/outputs/apk/debug/app-debug.apk` です。手元の実行でこのファイルが生成されたことを確認してから、端末へ移してください。

## 既にGradleがある場合

```sh
cd android
gradle --no-daemon assembleDebug lintDebug
```

**通常のGradle Wrapper JARはこのソース配布には含めていません。** 名前だけの偽の`gradlew`で代用はしていません。ローカルのGradleまたは補助スクリプトでWrapperを生成できます。

```sh
python tools/build_android.py --task wrapper
# 生成後、Android Studioで android/ を開いて同期する
```

## インストールと最初の確認

自分でビルドしたデバッグAPKを端末に転送してインストール、または開発者向け設定とUSBデバッグを確認して`adb install -r .../app-debug.apk`を実行します。端末の全体的なセキュリティ機能を無効にする必要はありません。

0.2.0はAI Link画面で起動します。最初は「通信自己診断（AIなし）」とWAV保存を確認します。AI接続は `AI-SETUP.md` を参照してください。モデル／推論ランタイムはアプリに含みません。左上のMorseTalkリンクで旧翻訳画面へ移動できます。旧画面では文字「はい」を入力し、送信プレビューとWAVセルフテストを確認します。次にマイク権限を許可して受信を開始します。Android 12以降の対応端末ではオンデバイス音声認識の言語データとオフラインTTS音声を準備し、「声を文字に」で短く話します。権限の初回ダイアログなどで操作が停止した場合は、許可後にもう一度開始します。

外部音声認識に切り替わる救済動作はありません。認識非対応端末でも文字入力・モールス変換を使えます。

## 公開する前の必須ゲート

`DEVICE-TEST-PLAN.md`のWindows/Android実機検証、Android Lint、権限拒否・通話割込み・ロック画面、APK内同梱資産、ネットワーク遮断下での音声認識を確認してください。

デバッグキーのAPKを製品版として配布しないでください。製品版キーは所有者自身で作成・保管し、リポジトリに秘密鍵やパスワードを入れないでください。この配布物には署名秘密鍵も自動公開設定もありません。
