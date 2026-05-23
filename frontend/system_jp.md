# Alfresco Extract System — フロントエンド技術リファレンス

## 目次

1. [概要](#1-概要)
2. [技術スタック](#2-技術スタック)
3. [アプリケーション構成](#3-アプリケーション構成)
4. [ルーティングとページ](#4-ルーティングとページ)
5. [APIクライアント](#5-apiクライアント)
6. [データ取得とポーリング](#6-データ取得とポーリング)
7. [状態管理](#7-状態管理)
8. [主要ページの詳細な動作](#8-主要ページの詳細な動作)
9. [国際化（i18n）](#9-国際化i18n)
10. [UIから見たマイグレーションフロー](#10-uiから見たマイグレーションフロー)
11. [プログレスバーのロジック](#11-プログレスバーのロジック)
12. [UIでの重複ファイル対応](#12-uiでの重複ファイル対応)
13. [テーマ・デザインシステム](#13-テーマデザインシステム)
14. [ビルドと開発](#14-ビルドと開発)

---

## 1. 概要

フロントエンドは **シングルページ React アプリケーション** で、以下の機能を提供します：

- すべての Alfresco サイトを一覧・参照する **Sites ブラウザ**。
- ジョブ作成前にサイト内のフォルダ/ファイルツリーを閲覧する **ファイルエクスプローラー**。
- 全抽出ジョブとリアルタイムのステータスを表示する **Jobs ダッシュボード**。
- ファイルごとの進捗とジョブ制御（開始・一時停止・再開・削除）、マイグレーション制御（開始・一時停止・再開・差し戻し）を行う **ジョブ詳細** ビュー（3タブ）。

全API通信は単一の型付きクライアント（`api/client.ts`）を通じて行います。ReduxもZustandも使用しません — 状態はReact Queryのキャッシュで管理され、ポーリングで更新されます。

---

## 2. 技術スタック

| ライブラリ                    | バージョン | 用途                                                                |
| ----------------------------- | ---------- | ------------------------------------------------------------------- |
| React                         | 18         | UIフレームワーク                                                    |
| TypeScript                    | 5          | 型安全性                                                            |
| Vite                          | 5          | ビルドツール＆開発サーバー                                          |
| Mantine                       | v7         | UIコンポーネントライブラリ（Modal・Table・Badge・Progress・Tabs等） |
| Lucide React                  | —          | アイコンセット                                                      |
| TanStack Query（React Query） | v5         | サーバー状態・キャッシュ・ポーリング                                |
| React Router DOM              | v6         | クライアントサイドルーティング                                      |
| react-i18next                 | —          | 国際化（英語・日本語）                                              |

---

## 3. アプリケーション構成

```
frontend/src/
├── api/
│   └── client.ts          — 全APIタイプ＋フェッチ関数（唯一の信頼できる情報源）
├── components/
│   └── AppLayout.tsx      — シェル：トップナビ・言語切替・カラースキーム切替
├── hooks/
│   ├── useJobs.ts         — ジョブ・ファイル・マイグレーション用React Queryフック
│   ├── useSites.ts        — サイト一覧クエリフック
│   └── useBrowse.ts       — フォルダ/ファイルツリー参照クエリフック
├── i18n/
│   ├── i18n.ts            — i18next初期化（言語検出・名前空間）
│   └── locales/
│       ├── en.json        — 英語翻訳文字列
│       └── ja.json        — 日本語翻訳文字列
├── pages/
│   ├── SitesPage.tsx      — Alfrescoサイト一覧（「参照」・「ジョブ作成」ボタン付き）
│   ├── ExplorerPage.tsx   — ジョブスコープ選択のためのファイルエクスプローラー
│   ├── JobsPage.tsx       — 全ジョブのテーブル（ステータスバッジ付き）
│   └── JobDetailPage.tsx  — ジョブ詳細：ファイルタブ・コピータブ・マイグレーションタブ
├── App.tsx                — QueryClientのセットアップ・ルーター定義・Mantineテーマプロバイダー
├── main.tsx               — React DOMエントリーポイント
├── theme.ts               — カスタムMantineテーマのオーバーライド
└── utils.ts               — 共有ヘルパー（formatBytes・formatSpeed等）
```

---

## 4. ルーティングとページ

ルートは `App.tsx` 内の `createBrowserRouter` で定義されています：

| URL                        | コンポーネント  | 用途                                |
| -------------------------- | --------------- | ----------------------------------- |
| `/`                        | —               | `/sites` にリダイレクト             |
| `/sites`                   | `SitesPage`     | 全Alfrescoサイトの一覧              |
| `/sites/:siteName/explore` | `ExplorerPage`  | フォルダ/ファイルの参照とジョブ作成 |
| `/jobs`                    | `JobsPage`      | 全ジョブのダッシュボード            |
| `/jobs/:jobId`             | `JobDetailPage` | ジョブ詳細ビュー                    |

全ルートは `AppLayout` ラッパー（トップナビ・言語切替）を共有します。

---

## 5. APIクライアント

**ファイル:** `src/api/client.ts`

APIタイプとフェッチ呼び出しを定義する **唯一の** ファイルです。コンポーネント内にAPIタイプをインラインで定義しないこと。

### 型定義

```typescript
// コアのジョブ/ファイルステータス列挙型
type JobStatus = "created"|"scanning"|"scanned"|"copying"|"done"|"paused"|"failed"|"migrating"|"migrated";
type FileStatus = "pending"|"copied"|"failed"|"skipped";
type MigrationStatus = "pending"|"migrated"|"failed"|"skipped";

// 主要データ形式
interface Job { id, site_name, status, total_files, scanned_files, copied_files, ... }
interface FileRecord { id, node_ref, full_path, file_name, status, local_export_path, ... }
interface MigrationRecord { id, job_id, file_record_id, status, uuid_filename, duration_ms, ... }
interface MigrationProgress { status, total, migrated, failed, pending, skipped, records[] }
interface BrowseResult { site_name, folders[], files[], current_node_id, parent_node_id? }
```

### API 名前空間

```typescript
api.health.get()                            // GET /api/health
api.sites.list()                            // GET /api/sites
api.browse.get(siteName, parentId?)         // GET /api/sites/{name}/browse[?parent_id=...]
api.browse.search(siteName, q, limit)       // GET /api/sites/{name}/search?q=...
api.browse.folderSize(siteName, nodeIds)    // GET /api/sites/{name}/folder-size?node_ids=...
api.jobs.list()                             // GET /api/jobs
api.jobs.get(id)                            // GET /api/jobs/{id}
api.jobs.create(payload)                    // POST /api/jobs
api.jobs.startCopy(id)                      // POST /api/jobs/{id}/start-copy
api.jobs.pause(id)                          // POST /api/jobs/{id}/pause
api.jobs.resume(id)                         // POST /api/jobs/{id}/resume
api.jobs.delete(id)                         // DELETE /api/jobs/{id}
api.files.list(jobId, {status,limit,offset}) // GET /api/jobs/{id}/files
api.files.csvUrl(jobId)                     // /api/jobs/{id}/csv（ダウンロードリンク用直接URL）
api.migration.start(id)                     // POST /api/jobs/{id}/migrate
api.migration.get(id, page, limit)          // GET /api/jobs/{id}/migration
api.migration.pause(id)                     // POST /api/jobs/{id}/migration/pause
api.migration.resume(id)                    // POST /api/jobs/{id}/migration/resume
api.migration.revert(id)                    // DELETE /api/jobs/{id}/migration
api.migration.sqlUrl(id)                    // /api/jobs/{id}/migration/sql（ダウンロードリンク）
```

### エラー処理

全呼び出しは共有の `request<T>()` ヘルパーを通じ、非OKレスポンスに対して `Error("API {status}: {body}")` をスローします。コンポーネントは try/catch またはReact Queryの `error` 状態でラップすること。

### URLルーティング（開発 vs 本番）

- **開発**: Vite設定が `/api/*` → `http://localhost:8000/api/*` にプロキシ。
- **本番**: nginxがViteの `dist/` を配信し、`/api/` → `backend:8000` にプロキシ。

絶対URLは使用しない — 全呼び出しは `/api/...`（相対パス）を使用。

---

## 6. データ取得とポーリング

全サーバー状態は **TanStack React Query v5** を使用。`setInterval` を使った `useEffect` は使用しません — ポーリングは `refetchInterval` で宣言的に管理されます。

### グローバルクエリクライアント（App.tsx）

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000, // キャッシュ結果が古くなるまでの時間（10秒）
    },
  },
});
```

### フックごとのポーリング間隔

| フック           | 間隔 | 条件                                                             |
| ---------------- | ---- | ---------------------------------------------------------------- |
| `useJobs()`      | 4秒  | Jobsページ表示中は常時                                           |
| `useJob(id)`     | 3秒  | ステータスが `scanning`・`copying`・`migrating` の場合のみ       |
| `useJobFiles()`  | 2秒  | ステータスが `copying` または `scanning` の場合のみ              |
| `useMigration()` | 3秒  | マイグレーションレスポンスの `status === "migrating"` の場合のみ |

ジョブが終端状態（`done`・`migrated`・`failed`・`paused`）に達すると、ポーリングは自動的に停止します。

### キャッシュの無効化

ミューテーション（開始・一時停止・再開・削除）の後、React Queryの `invalidateQueries()` を呼び出して影響を受けるクエリを強制的に再フェッチします。これにより、UIが新しい状態を即座に反映します。

---

## 7. 状態管理

**グローバルな状態ストアは存在しません**（Redux・Zustand・ビジネスデータ用のContextなし）。全サーバー状態はReact Queryで管理されます。ローカルのUI状態（モーダル開閉・選択フォルダ・現在のページ）は `useState` を使用します。

**主要フックのまとめ：**

```typescript
// ジョブ一覧ページ
const { data: jobs } = useJobs(); // 4秒ごとにポーリング

// ジョブ詳細ページ
const { data: job } = useJob(id); // アクティブ時に3秒ごとにポーリング
const { data: files } = useJobFiles(id, page, limit, status, job.status);
const { data: migration } = useMigration(id, job.status);

// ミューテーション
const { startCopy, pause, resume } = useJobAction(id);
const { start, pause, resume, revert } = useMigrationActions(id);
```

---

## 8. 主要ページの詳細な動作

### 8.1 SitesPage

- マウント時に `api.sites.list()` を取得。
- 全Alfrescoサイトをカードグリッドで表示。
- **「参照」ボタン** → `/sites/:siteName/explore` に遷移。
- **「ジョブ作成」ボタン** → 確認モーダルを表示し、`api.jobs.create({ site_name })` を呼び出す（フォルダ選択なし — サイト全体のマイグレーション）。

### 8.2 ExplorerPage

- 2ペインのファイルブラウザを表示：フォルダツリー（左）＋ファイル一覧（右）。
- フォルダナビゲーション: フォルダクリックで `api.browse.get(siteName, nodeId)` を呼び出す。パンくずリストが現在のパスを追跡。
- フォルダ/ファイル選択: チェックボックスで特定のフォルダやファイルを選択できる。ジョブは選択されたスコープのみスキャン。
- **フォルダサイズのヒント**: 選択フォルダのサイズを `api.browse.folderSize()` で取得。
- **「ジョブ作成」ボタン**: `api.jobs.create({ site_name, selected_folder_node_ids, selected_file_node_ids })` を呼び出す。
- **ファイル検索**: 検索バーが `api.browse.search()` を呼び出し、サイト内のファイルをすばやく検索。

### 8.3 JobsPage

- `useJobs()` を取得 — 4秒ごとにポーリング。
- テーブルには以下を表示：サイト・ステータスバッジ・総ファイル数・コピー済み・失敗・作成日時。
- 任意の行クリックで `/jobs/:jobId` に遷移。
- 確認モーダル付きの削除ボタンが `api.jobs.delete(id)` を呼び出す。

### 8.4 JobDetailPage

最も複雑なページ。3つのタブがあります：

**タブ1 — ファイル**（`scanning` / `scanned` フェーズ）：

- 全 `FileRecord` 行をページネーション（1ページ100件）で表示。
- ステータスフィルタードロップダウン（全件/pending/copied/failed/skipped）。
- カラム：ファイル名・パス・サイズ・ステータス・速度・エラー。
- `scanning` または `copying` 中は2秒ごとにポーリング。
- CSVエクスポートダウンロードリンク（`api.files.csvUrl(id)`）。

**タブ2 — コピー**（`copying` / `done` フェーズ）：

- 全体コピー進捗バー: `copied_size_bytes / total_size_bytes`。
- バッジ行にファイルごとのステータス数。
- 「コピー開始」ボタン（`scanned` ステータスから）。
- 「一時停止」・「再開」コントロール。
- ファイルテーブルはタブ1と同じ。

**タブ3 — マイグレーション**（`done` / `migrating` / `migrated` フェーズ）：

- `job.status` が `done`・`migrating`・`migrated`・`paused`・`failed` の場合のみ有効。
- 「マイグレーション開始」ボタン（`done` から）。
- 一時停止・再開・差し戻しコントロール。
- 進捗バー: `(migrated + skipped) / total * 100` — スキップされたファイルは完了としてカウント。
- タブバッジは `migrated + skipped / total` を表示。
- `MigrationRecord` テーブル（カラム: ファイル・元パス・ステータス・UUIDファイル名・処理時間・エラー）。
- SQLエクスポートダウンロードリンク（`api.migration.sqlUrl(id)`）。

---

## 9. 国際化（i18n）

**ライブラリ:** `react-i18next`

**対応言語:** 英語（`en`）と日本語（`ja`）。

**言語検出順序:**

1. `localStorage` キー `i18nextLng`。
2. ブラウザのナビゲーター言語。
3. フォールバック: `en`。

**翻訳ファイル:**

- `src/i18n/locales/en.json`
- `src/i18n/locales/ja.json`

**キー構造:**

```json
{
  "nav": { "sites": "...", "jobs": "..." },
  "jobStatus": { "created": "...", "scanning": "...", ... },
  "fileStatus": { "pending": "...", "copied": "...", ... },
  "migrationStatus": { "pending": "...", "migrated": "...", "failed": "...", "skipped": "...", "queued": "..." },
  "migration": { "title": "...", "startButton": "...", ... },
  "jobs": { ... },
  "sites": { ... },
  "explorer": { ... }
}
```

**コンポーネントでの使用:**

```typescript
const { t } = useTranslation();
// t("migrationStatus.migrated") → "Migrated" / "マイグレーション完了"
// t("jobStatus.copying") → "Copying…" / "コピー中…"
```

**言語切替:** `AppLayout.tsx` 内で `en` / `ja` を切り替え、`localStorage` に保存。

**ルール:** コンポーネントにハードコードされたUI文字列を書かないこと。ユーザーに表示されるテキストはすべてロケールJSONファイルに記述すること。

---

## 10. UIから見たマイグレーションフロー

マイグレーションフローは `JobDetailPage` の **マイグレーションタブ** から完全に制御されます：

```
ジョブステータス = done
  ↓ ユーザーが「マイグレーション開始」をクリック
  ↓ api.migration.start(id) → POST /api/jobs/{id}/migrate
  ↓ バックエンドが migrate_site_task を Celery にディスパッチ

ジョブステータス = migrating
  ↓ useMigration() が3秒ごとにポーリング
  ↓ MigrationProgress.records[] がファイルごとのステータスで更新

ジョブステータス = migrated / failed / paused
  ↓ ポーリング停止
  ↓ 最終状態をテーブルに表示

ユーザーが「一時停止」をクリック
  → api.migration.pause(id) → バックエンドがstatus=pausedに設定、Celeryタスクを失効
  → refetchInterval が false を返す → ポーリング停止

ユーザーが「再開」をクリック
  → api.migration.resume(id) → バックエンドが新しい migrate_site_task をディスパッチ
  → refetchInterval が 3000 を返す（レスポンスのstatus=migratingに基づく）

ユーザーが「差し戻し」をクリック
  → 確認モーダル
  → api.migration.revert(id) → DELETE /api/jobs/{id}/migration
  → マイグレーション済みファイルがターゲットDBと target-storage/ から削除
  → ジョブがstatus=doneに戻る
```

### UIでのスキップ（重複）ファイル

ターゲットシステムにすでに存在するファイル（同じ `source_node_ref`）の場合、バックエンドは `MigrationRecord` を以下のようにマークします：

- `status: "skipped"`
- `error_msg: "Already migrated from another job"`

UIではこれらの行を黄/オレンジの「スキップ（重複）」バッジで表示します。進捗バーの計算では「完了」としてカウントされます。

---

## 11. プログレスバーのロジック

### コピーフェーズの進捗

```typescript
// 総バイト数の進捗（実際に転送されたデータを表示）
const copyProgress =
  job.total_size_bytes > 0
    ? (job.copied_size_bytes / job.total_size_bytes) * 100
    : 0;
```

### マイグレーションフェーズの進捗

```typescript
// (migrated + skipped) を完了としてカウント — skipped = 重複 = すでにターゲットに存在
const migrationProgress =
  migration.total > 0
    ? ((migration.migrated + migration.skipped) / migration.total) * 100
    : 0;

// タブバッジ（例: "8/10"）
const migrationTabBadge = `${migration.migrated + migration.skipped}/${migration.total}`;
```

**スキップを完了としてカウントする理由:** 「スキップ」されたファイルは、別のジョブからターゲットシステムにすでに存在することを意味します。マイグレーションの完了率の観点からは実質的にマイグレーション済みです。`migrated` のみカウントすると、重複がある場合に進捗バーが100%に達しなくなります。

---

## 12. UIでの重複ファイル対応

同じファイルをカバーする2つのジョブを実行した場合（例: 同一サイトの2ジョブ、またはフォルダ選択が重複）：

1. 2番目のジョブのマイグレーションタスクが、ターゲットDBに既に存在するファイルを検出（`source_node_ref` 一致）。
2. それらのファイルが `MigrationRecord` で `skipped` にマークされる。
3. UIのマイグレーションタブでは：
   - ステータスサマリー行に専用の **スキップ** カウントを表示。
   - テーブルの各 `skipped` レコードに「スキップ（重複）」バッジを表示。
   - 進捗バーは正常に進む（スキップ = 完了）。
4. ターゲットシステムの元のファイルは **影響を受けない** — 二重挿入なし。

UIでは純粋に情報表示のみ — ユーザーによる操作は不要。

---

## 13. テーマ・デザインシステム

- **Mantine v7** がコンポーネントライブラリを提供（モーダル・バッジ・テーブル・タブ・プログレスバー・通知等）。
- **カスタムテーマ** は `theme.ts` でプライマリカラー・フォント・角丸・スペーシングのオーバーライドを定義。
- **カラースキーム**: ライト/ダークモード切替。`localStorageColorSchemeManager` で `localStorage` に保存。
  - ストレージキー: `aes-color-scheme`。
- **Lucide React** が全アイコンを提供（統一されたストロークスタイルのアイコンセット）。

---

## 14. ビルドと開発

### 開発環境

```bash
cd frontend
npm install
npm run dev     # Vite開発サーバー http://localhost:5173 (/api プロキシ付き)
```

**Viteプロキシ設定**（`vite.config.ts`）：

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:8000',
  }
}
```

### 本番ビルド

```bash
npm run build   # TypeScriptコンパイル + Viteバンドル → dist/
```

出力: 本番環境ではnginxが配信する `dist/` ディレクトリ。

### Docker

フロントエンドはマルチステージ `Dockerfile` を使用：

1. **builder** ステージ: `node:20-alpine` → `npm ci` → `npm run build`。
2. **production** ステージ: `nginx:alpine` → `dist/` をnginxのWebルートにコピー。

nginx設定は `/api/` を `backend:8000` にプロキシします。

### 環境変数

フロントエンドの環境変数はViteの `VITE_` プレフィックスを使用し、ビルド時にバンドルに組み込まれます：

| 変数            | 用途                                                         |
| --------------- | ------------------------------------------------------------ |
| `VITE_API_BASE` | `/api` ベースパスを上書き（オプション；デフォルトは `/api`） |

その他の設定（バックエンドURL・DB認証情報）はバックエンドの `.env` に留めます。フロントエンドが知る必要があるのはAPIベースパスのみです。
