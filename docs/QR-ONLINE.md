# MorseTalk 0.4.0 — QRペアリングとオンライン交信

## 2つの通信方式

音響は従来のMT2モールス音→マイク→復号です。オンラインはMT2フレームを**点と線のモールス符号列**に変換し、AES-GCMで暗号化してWebSocket中継を通します。相手は認証・復号・モールス復元・CRC検査を行います。ACKも同じ暗号化経路です。音声やPCMをインターネットに流す方式ではなく、WPM相当の時間待ちはありません。

Androidは既存の端末内Gemma 4 E2Bを利用できます。WindowsのAIはローカルOllamaを設定します。手入力を選べばAIモデルもAI処理の許可も不要です。オンライン交信には別途ネット接続の許可が必要です。

## QRだけで設定を渡す（オフライン・音響）

A/B・速度・通信コード・セッションを設定し「音響設定のQRを表示」を押します。相手はアプリの「カメラでQRを読む」またはQR画像の読み込みを使い、表示された内容を確認して「確認した設定を適用」を押します。読み込んだだけでは設定変更・録音・AI生成を始めません。カメラを止めるボタンで動画トラックを解放します。

QRはPNGで保存できます。スマートフォンの標準カメラからアプリを直接起動するディープリンクは今回未実装です。アプリ内で読むか、スクリーンショットを読み込むか、接続コードを貼り付けてください。

## オンラインで2台を接続する

**公開中継サーバーは同梱・運用していません。初期状態で利用できる公開接続先もありません。** まず所有するサーバーに下記のrelayを設置し、WSSのURLを用意します。アプリの `relay.example.com` は記入例で、動作するサービスではありません。

1. A側で「オンライン」と「Gemma自動会話」または「手入力」を選択し、`wss://実際のホスト/v1` を入力します。
2. Aで招待を作り、相手だけにQRのPNGまたは招待文を渡します。Aは端末Aに設定されます。
3. Bが読み込み、接続先ホスト・期限を確認して適用します。Bは端末Bになります。両端の会話方式も合わせてください。
4. 両端でネット交信の許可をチェックし、B→Aの順に「受信待機を開始」。暗号化ハンドシェイクが完了するまで送信できません。
5. 手入力ではAから文章を送り、交互に返信します。GemmaではAI処理も許可してモデルを準備し、Aから会話を開始します。

招待の期限は作成から15分で、接続中も期限に達すると停止します。相手待ちは60秒です。一度接続してから切断した招待は再利用できません。片側停止・画面非表示・ネット断で双方を止め、自動再接続しません。再開するときは**新しい招待を作り直して両端へ適用**してください。

QRと招待文には暗号鍵が含まれます。公開投稿や公開スクリーンショットに写さないでください。「鍵の一致」はQRの所有者であることの確認で、相手の本名や端末所有者の本人確認ではありません。秘密を知る第三者が先にBへ接続する可能性があり、信頼する経路で相手だけに渡す必要があります。

## 中継サーバーの設置

Docker/Compose導入済みのLinuxホスト、利用者が管理するDNS名、外部から到達できるTCP80/443が必要です。サーバーや通信には利用先の費用・利用条件が適用されます。ドメイン購入・クラウド契約・DNS変更・ポート開放はこのリポジトリが自動実行しません。

```sh
cd relay
export RELAY_DOMAIN=relay.your-domain.example
docker compose -f compose.public.yaml config -q
docker compose -f compose.public.yaml up -d --build
```

`RELAY_DOMAIN`は自分の実在するDNS名へ置き換えます。DNSをこのホストへ向けてから実行してください。CaddyがHTTPS証明書の取得・更新を行い、`/v1`を内部のrelayへ渡します。relayの8787はインターネットへ直接公開しません。既に80/443を利用しているホストでは、既存リバースプロキシに統合し競合させないでください。

```sh
curl --fail https://relay.your-domain.example/healthz
```

アプリの接続先は `wss://relay.your-domain.example/v1` です。TLS検証を無効にする設定はありません。証明書エラーはDNSと証明書側を直してください。

サービス停止:

```sh
docker compose -f compose.public.yaml down
```

証明書はcaddy_data/caddy_configボリュームに残ります。削除は所有者が意図したときだけ行ってください。

初期構成は小規模な2端末の実験向けです。1中継プロセス・最大128セッション・同時256接続・接続元16件上限です。リバースプロキシのIPからの接続はまとめて16件に制限されます（通常2端末を8組まで）。外部のForwardedヘッダーを無条件に信用して回避する実装にはしていません。秒間送信・キュー・メッセージサイズ・参加時間にも上限があります。大規模公開、DDoS防御、負荷分散、監視、障害復旧、第三者によるセキュリティ監査は別途必要です。

WindowsランチャーのOriginとAndroid appassets Originを許可します。任意のHTTPSホストでWeb版を独自公開する場合は、relayの `ALLOWED_ORIGINS` に自分の正確なOriginを設定する追加構成が必要です。`null` Originや任意Originは本番では許可しません。単独HTMLのQR自己診断はできますが、オンライン交信はWindowsランチャーまたはAndroidアプリを使ってください。

## 暗号化の範囲

256bitランダム共有秘密→HKDF-SHA256の方向別AES-GCM256鍵、12byteランダムIV、128bitタグを使います。セッション・方向を認証対象に含め、相互nonce確認と連番で再生を拒否します。共有秘密そのものを中継へ送らず、URLクエリや診断ログにも入れません。

中継は暗号文を転送するだけで本文を保存しませんが、接続元IP、接続時刻、通信量、部屋識別子、鍵から派生した参加トークンは見えます。TLS・ホストのログ運用も所有者の責任です。独立した暗号監査、前方秘匿性、実名認証はありません。音響モードのCRC/4桁コードは暗号化ではありません。高機密・安全がかかわる緊急用途に使わないでください。

Gemmaの入力はそれぞれが選択した推論先に渡ります。HTTP/外部モデルを明示選択した場合、中継本文の暗号化とは別に推論サーバーが平文入力を受け取ります。

## 再現する検証

```sh
python -m pip install -r relay/requirements.txt
node scripts/build.mjs
node --test tests/*.test.mjs
python -m unittest discover -s tests -p 'test_*.py'
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium
python tools/test_qr_ui.py
python tools/test_online_browser.py
# 実Gemmaが必要。代替応答で成功扱いにしない:
bash tools/start_ci_model.sh
python tools/test_online_browser.py --real-ai
```

QR仮想カメラ・PNG・loopback TCP・Androidエミュレーターは物理カメラや携帯回線を通す試験とは違います。成功件数とAPKの照合は、そのコミットのActions成果物を参照してください。テストスクリプトの存在だけで成功を主張しません。

## 一次資料

- Caddy reverse_proxy: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Automatic HTTPS: https://caddyserver.com/docs/automatic-https
- Android PermissionRequest: https://developer.android.com/reference/android/webkit/PermissionRequest
- QR decoder: https://github.com/cozmo/jsQR
- Python WebSocket server: https://websockets.readthedocs.io/en/stable/reference/asyncio/server.html

確認日2026-09-11。各ライブラリの同梱ライセンス・固定バージョンとSHA256はapp/licensesとQR-LIBRARY-PROVENANCE.jsonに収録。
