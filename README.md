# Ouboken PWA 試作

既存のPython / Windows EXE版とは独立した、iPhone用の静的Webアプリです。このフォルダだけを公開してください。親フォルダの `data`、`img`、EXE、応募者情報、APIキーは公開物に含めません。

## 使えること

- 写真を複数追加し、端末内のOCRでコード候補を読む。確認後、券別の自由記述を編集し、複数券のZIPをまとめて出力。
- 応募者情報・共通回答・券別回答・出力時の内容・手動の応募済み記録を端末内へ自動保存。
- ZIP内の `コピー一覧.txt` は改行区切り。先頭ゼロを保持、空欄と選択式回答は省略。`次の位置.txt` は `1`。既存のショートカット方式を使えます。
- パスワードで暗号化した写真込みの台帳バックアップと復元。
- 初回の読み込みが済めばアプリとOCRはオフラインで利用可能。応募先を開くときはネット接続が必要。

応募の送信・自動入力・応募サイトの操作は行いません。文章生成のLLMは試作では未接続です。元のPython版の文章生成設定は変更していません。

## iPhoneで使う

1. HTTPSの公開URLをSafariで開き、設定の「オフライン準備済み」を確認。
2. Safariの共有 →「ホーム画面に追加」。ホーム画面から起動したアプリで写真を追加。
3. コード確認 → コードごとの自由記述 → ZIPにまとめる。

Safariのタブとホーム画面のアプリで保存領域が分かれる場合があるため、最初にホーム画面へ追加してから使ってください。既に入力した場合は暗号化バックアップを保存し、ホーム画面側で復元します。

通常の保存先はこの端末・この公開URLのIndexedDBです。PC版のDPAPI暗号化とは異なり、ブラウザ内の台帳自体はアプリ独自の暗号化をしていません。暗号化されるのは `.ouboken` バックアップです。写真・住所・回答をサーバーへ送信する処理はありません。アプリ配信へのアクセス記録はホスティング側に残り得ます。

サイトの閲覧データ削除、端末交換、公開URL変更などで台帳を失うことがあるため、バックアップをファイルへ保存してください。パスワードは保存されません。忘れるとバックアップを復元できません。PC版の台帳を自動移行する機能はありません。

OCRはTesseract英語モデルを同梱。Oと0、QとGなどの誤認識は券面で修正してください。読めなかった写真も保存され、手入力できます。JPEG・PNG・WebP対応。HEICはJPEGへ変換して選び直してください。一度に最大150枚、各25MB以内。大きい写真は最大辺2000pxに縮小し、1枚ずつ処理します。読み取り中はアプリを前面に置くと安定します。

## GitHub Pagesへ公開

予定アカウント：`jgm8-8`。仮のリポジトリ名：`ouboken-pwa`。
予定URL：`https://jgm8-8.github.io/ouboken-pwa/`（まだ公開されていません）。

### ビルド済みファイルを公開する場合

1. GitHubに空のPublicリポジトリ `ouboken-pwa` を作成。
2. `release/ouboken-pwa-pages.zip` を展開し、中身をリポジトリのルートへアップロード。`index.html` がルートに来るようにします。隠しファイル `.nojekyll` も含めます。
3. Settings → Pages → Sourceを「Deploy from a branch」、Branchを `main` / `(root)` にして保存。
4. デプロイ成功後、上記URLをiPhoneで開きます。

### ソースから公開・更新する場合

`release/ouboken-pwa-source.zip` を展開した中身を空のリポジトリのルートに配置。Settings → Pages → Sourceを「GitHub Actions」に変更。`main` へpushするとテスト・ビルド・公開を実行します。ZIPをそのまま1ファイルとしてアップロードしてもサイトにはなりません。

この公開物に利用者の台帳は含まれません。アプリのURLは友人限定ではなく、アクセスできる人なら使えます。それぞれの端末で保存領域が独立します。

公式手順：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## 開発・検証

Node.js 24 / pnpm 11.25.0。独立したこのフォルダで実行します。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm preview
pnpm package
```

プレビュー：`http://127.0.0.1:8773/`。既存版の8765とは別です。HTTPのLANアドレスではiPhoneのPWAに必要な機能を確認できません。HTTPSのPages公開URLで確認します。

`dist/` は全OCRモデルを含む静的ファイルです。Python・常駐PC・APIサーバーは不要です。依存ライセンスは `dist/THIRD_PARTY_NOTICES.txt`。通信先を同じサイトに制限するCSPを設定しています。将来LLMを接続するときは公開JavaScriptにAPIキーを埋め込まず、別途設計が必要です。
