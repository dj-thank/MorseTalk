# Android APKの取得・ビルド・確認

## 0.2.2の検証済み状態

**APKの生成・署名検査・Androidエミュレーターへのインストール・実行検証は完了しています。**
最終PR検証は https://github.com/dj-thank/MorseTalk/actions/runs/34564521406 です。
4ジョブすべて成功し、Androidでは9項目の実行検証とLint（0エラー・2警告）を確認しました。
WindowsのPowerShellランチャーとローカルサーバーも実Windowsランナーで検証しています。
物理的なWindows／Android端末のマイク・スピーカー間通信や実音声の認識品質は、別の未実施試験です。

Actionsの **MorseTalk-installable-debug-APK** 成果物ZIPに、次を含みます。

- `android/app/build/outputs/apk/debug/app-debug.apk`
- `test-results/android/APK-SHA256.txt` と署名検査結果
- `test-results/source-commit.txt`

上記最終PR実行のAPKのSHA-256:

```text
4e971bbce9bc8566d16a14feab3e70e8cd2f8a9f620cc39b04325ea60c49cad5
```

CI実行を変えるとデバッグ署名やAPKのハッシュが変わり得るため、必ず同じ実行の記録で照合してください。
アプリはAndroid 8.0以上を対象とし、実行検証はAndroid 15 / API 35エミュレーターです。
ストア配布用の製品版署名ではありません。モデル・AI推論ランタイムはAPKに含みません。

## ソースからビルドするための環境

SDK Platform 35、SDK Build-Tools 35.0.0、JDK 17、Gradle 8.11.1を使用します。
Android Gradle Pluginは8.9.2です。SDK等のライセンスは開発者自身で確認してください。
`ANDROID_HOME`をSDKフォルダーに設定するか、`android/local.properties`へ`sdk.dir`を指定します。
`local.properties`には端末固有パスが入るため、リポジトリへ登録しません。

Gradleが導入済みの場合:

```sh
cd android
gradle --no-daemon assembleDebug assembleDebugAndroidTest lintDebug
```

アプリAPKは `android/app/build/outputs/apk/debug/app-debug.apk` へ出力されます。
テストAPKは `android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` です。

## 補助スクリプト

WindowsはPython 3.10以降とPython Launcherを用意し、`Build-Android.cmd`を実行します。
macOS / Linuxは、自分のSDKとJDKのパスを指定して次を実行します。

```sh
export ANDROID_HOME="$HOME/Android/Sdk"
export JAVA_HOME="/path/to/jdk-17"
python tools/build_android.py --task assembleDebug
python tools/build_android.py --task lintDebug
```

Gradleが `.tools/` にない場合、補助スクリプトは確認後に公式ZIPとSHA-256ファイルをHTTPSで取得します。
SDKやJavaの自動導入、OS設定変更、製品版署名やストア公開は行いません。
初回のGradleプラグイン取得にはオンライン接続が必要です。会話音声の送信とは別の通信です。
このソースはGradle Wrapper JARを同梱せず、必要なら次で生成します。

```sh
python tools/build_android.py --task wrapper
```

CIでは別途 `android-actions/setup-android` でSDKを用意し、署名検査、インストール、実行検証を自動化しています。

## インストールと初回確認

端末所有者がインストールを許可し、生成済みデバッグAPKを開きます。
開発用USB接続を承認済みの場合は、次の方法も使えます。

```sh
adb install -r path/to/app-debug.apk
```

既存版と署名が異なる場合、上書きインストールはできません。
旧版の削除が必要になったときは、削除でローカル履歴が失われるため先に必要な履歴を書き出してください。
端末全体のセキュリティ機能を無効にする必要はありません。

0.2.2はAI Link画面で起動します。「通信自己診断（AIなし）」とWAV保存を最初に確認してください。
AIとの会話にはモデルサーバーへの接続が必要です。`AI-SETUP.md`にPC上のAIをUSB経由で使う手順もあります。
左上のMorseTalkリンクで旧翻訳画面へ移動でき、音声認識を使わず文字入力から試せます。
マイク受信では初回の権限を確認し、ダイアログで操作が停止した場合は許可後にもう一度開始します。
Android 12以降の対応端末で音声認識を使う場合は、オンデバイス言語データを別途用意します。
非対応時にクラウド認識へ自動で切り替える実装ではありません。

## 製品版公開の前に残る確認

`DEVICE-TEST-PLAN.md`に沿い、実機2台の距離・反響・雑音、権限拒否、通話割込み、画面ロック、実音声の認識と読み上げを確認してください。
Lintの残り2警告はtarget API更新とAndroid 12以降のデータ抽出設定です。抑制して消してはいません。
製品版キーは所有者自身で作成・保管し、秘密鍵やパスワードをリポジトリへ登録しないでください。
今回のAPKを製品版署名済み・全実機動作保証済みとして配布しないでください。
