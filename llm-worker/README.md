# 文章整形の中継サーバー（参考実装）

現行PWAは利用者本人のAPIキーで直接OpenAIへ接続し、このWorkerを呼びません。中継方式へ戻す場合の参考実装です。その場合はフロントの接続処理とCSPの変更も必要です。

GitHub Pagesとは独立したCloudflare Workerです。GitHub PagesはAPIキーを安全に保管してサーバー処理する場所ではないため、文章整形の呼び出しだけを中継します。写真読み取り・台帳保存・ZIP生成は端末内で処理します。

## 公開手順

Cloudflareアカウントを用意して、このフォルダで実行します。Node.jsが必要なのは開発・公開時だけです。友人の利用時にPCは不要です。

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_TOKEN
```

`OPENAI_API_KEY` はOpenAIのプロジェクト用APIキー、`APP_TOKEN` は友人向けに用意する24文字以上のランダムな利用コードです。キーと利用コードは各コマンドの入力待ちで入力します。コマンド引数・ソース・チャットに貼りません。実際のキーを設定したファイルをリポジトリへ追加しないでください。初回公開からSecret設定完了までは503を返し、AIを呼びません。

公開時に表示される `https://ouboken-polish.<サブドメイン>.workers.dev` をPWAの設定「接続先」に入力し、`APP_TOKEN` を「利用コード」に入力します。APIキーは友人へ渡しません。利用コードを知る人は中継を利用できるため、公開リポジトリ・公開チャットに書かないでください。管理画面からSecretを変更すれば旧コードを失効できます。

`wrangler.jsonc` の `ALLOWED_ORIGIN` は現在のPagesのオリジン、`MODEL` は `gpt-4o-mini` です。URLを変更する場合はこの設定も合わせます。利用コード・入力・接続元を検証し、文章だけを固定のOpenAI Responses APIへ送信。store=false、構造化出力、文字数制限、未完了・拒否・エラー処理を実装しています。リクエスト本文や秘密情報をログ出力せず、レスポンスはno-storeです。

1分10回のCloudflare Rate Limiting bindingを設定しています。これは拠点単位の制限で、月額支出の厳密な上限ではありません。無料Workerの利用枠とOpenAI APIの課金は別です。APIキーはこの用途専用のプロジェクトに分けると、利用量を確認しやすくなります。

## 検証範囲

親フォルダで `pnpm test` / `pnpm build`。認証・接続元・入力の拒否、文章のみの送信、構造化出力・store=false、異常応答の処理をAPIキー不要のモックで検証しています。実際のCloudflare公開とOpenAIへの呼び出しは、アカウントとSecret設定後に確認する必要があります。

公式資料：

- [APIキーの保管](https://developers.openai.com/api/reference/overview)
- [構造化出力](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Workers Secret](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)
- [Rate Limitingの制限](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
