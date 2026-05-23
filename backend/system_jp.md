# Alfresco Extract System — バックエンド技術リファレンス

## 目次

1. [システム概要](#1-システム概要)
2. [アーキテクチャ・コンポーネント](#2-アーキテクチャコンポーネント)
3. [データベース接続](#3-データベース接続)
4. [Alfresco PostgreSQL — テーブルとクエリ](#4-alfresco-postgresql--テーブルとクエリ)
5. [フェーズ1 — スキャン（抽出）](#5-フェーズ1--スキャン抽出)
6. [フェーズ2 — ファイルコピー](#6-フェーズ2--ファイルコピー)
7. [フェーズ3 — マイグレーション](#7-フェーズ3--マイグレーション)
8. [ジョブライフサイクルと状態遷移](#8-ジョブライフサイクルと状態遷移)
9. [並行処理・マルチジョブ対応](#9-並行処理マルチジョブ対応)
10. [一時停止・再開の仕組み](#10-一時停止再開の仕組み)
11. [重複防止](#11-重複防止)
12. [再開可能性とべき等性](#12-再開可能性とべき等性)
13. [設定リファレンス](#13-設定リファレンス)
14. [ファイルパス解決](#14-ファイルパス解決)

---

## 1. システム概要

本システムは **Alfresco Community Edition** サイトのすべてのファイルとメタデータを以下の手順で抽出します：

1. **スキャン**: Alfresco PostgreSQL データベースを照会し、全ファイルノードを列挙。
2. **コピー**: Alfresco の contentstore から物理ファイルをローカルの `exports/` ディレクトリへコピー。元のファイル名とフォルダ階層を保持。
3. **マイグレーション**: コピーしたファイルをターゲットのファイルマネージャーDBへ移行。フォルダ・ファイル行を挿入し、UUID形式でファイルを `target-storage/` に配置。

50,000 件以上の混在ファイル（動画、画像、PDF、Officeドキュメント等）の一括移行を想定しており、完全な再開可能性を持ちます。ジョブを一時停止して再開しても、処理済みファイルを再処理しません。

---

## 2. アーキテクチャ・コンポーネント

```
FastAPI (uvicorn:8000)
  ├── /api/sites        — Alfrescoサイト一覧
  ├── /api/sites/{name}/browse — フォルダツリー参照
  ├── /api/jobs         — 抽出ジョブのCRUD
  ├── /api/jobs/{id}    — ジョブ詳細・ファイルレコード
  └── /api/jobs/{id}/migrate — マイグレーション制御

Celery Worker (worker.celery_app)
  ├── tasks.extract_site_task   — フェーズ1（スキャン）
  ├── tasks.copy_site_task      — フェーズ2（コピー）
  └── tasks.migrate_site_task   — フェーズ3（マイグレーション）

Redis           — Celery ブローカー + 結果バックエンド
ローカルPostgreSQL (aes_tracking) — ジョブ追跡DB
Alfresco PostgreSQL (読み取り専用) — ソースメタデータ
ターゲットPostgreSQL              — マイグレーション先
```

**主要ソースファイル：**

| ファイル                            | 責任範囲                                                    |
| ----------------------------------- | ----------------------------------------------------------- |
| `app/services/alfresco_db.py`       | Alfresco PGへの全生SQLクエリ（他のファイルにSQLを書かない） |
| `app/services/extractor.py`         | フェーズ1スキャンロジック                                   |
| `app/services/file_copier.py`       | フェーズ2コピーロジック                                     |
| `app/services/migration_service.py` | フェーズ3マイグレーションロジック                           |
| `app/services/path_builder.py`      | alf_child_assocを使ったパス解決                             |
| `worker/tasks.py`                   | 3フェーズすべてのCeleryタスクラッパー                       |
| `app/models/job.py`                 | Job + FileRecord ORMモデル                                  |
| `app/models/migration.py`           | MigrationRecord ORMモデル                                   |
| `app/config.py`                     | Pydantic Settings（環境変数ベース）                         |

---

## 3. データベース接続

### 3.1 Alfresco PostgreSQL（読み取り専用）

- **目的**: 全ファイルメタデータとコンテンツURL参照のソース。
- **アクセス**: 読み取り専用。書き込み不可。`text()` による生SQLのみ — `alf_*` テーブルにORMモデルはマッピングしない。
- **接続**: `app/db/alfresco.py` が SQLAlchemy エンジン（`pool_pre_ping=True`）で管理。
- **セッションライフサイクル**: フェーズ1スキャン中のみ開く。フェーズ2・3では使用しない。

```python
# config.py
alfresco_db_url: str  # 例: postgresql://alfresco:alfresco@localhost:5432/alfresco
```

### 3.2 ローカルPostgreSQL — `aes_tracking`

- **目的**: `jobs`・`file_records`・`migration_records` を保存。ジョブ状態の信頼できる情報源。
- **アクセス**: 読み書き。SQLAlchemy ORM。
- **プール**: `pool_size=5`、`max_overflow=10`。
- **FastAPIのセッション**: `Depends(get_local_db)` で注入 — リクエスト終了後に自動クローズ。
- **Celeryのセッション**: タスク開始時に手動でオープン、`finally` ブロックでクローズ。

```python
local_db_url: str  # 例: postgresql://aes_user:aes_pass@localhost:5432/aes_tracking
```

### 3.3 ターゲットPostgreSQL — `target_files`

- **目的**: マイグレーション先。新しいファイルマネージャーの `folders` と `files` 行を格納。
- **アクセス**: 読み書き。`text()` による生SQL。
- **セッションライフサイクル**: `migrate_site_task` 開始時にオープン、`finally` でクローズ。ローカルDBとは独立したセッション（片方のロールバックが他方に影響しない）。

```python
target_db_url: str  # 例: postgresql://target_user:target_pass@target_db:5432/target_files
```

### 3.4 Redis

- **目的**: Celeryメッセージブローカーおよびタスク結果バックエンド。
- **結果有効期限**: 7日間（`result_expires=86400 * 7`）。

---

## 4. Alfresco PostgreSQL — テーブルとクエリ

### 4.1 主要テーブル

| テーブル              | 用途                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alf_store`           | ワークスペースストア（SpacesStore）                                                                                                                  |
| `alf_node`            | 全ノード（ファイル・フォルダ・サイト）。`id`、`uuid`、`type_qname_id`、`audit_creator`、`audit_created`、`audit_modifier`、`audit_modified` を持つ。 |
| `alf_child_assoc`     | 親→子の関係。`type_qname_id` = 通常ツリー走査は `cm:contains`。`child_node_name` = ノード名。`is_primary=TRUE` = 正規の親。                          |
| `alf_node_properties` | 全メタデータ値 — `string_value`・`long_value`・`float_value`・`boolean_value`・`serializable_value`。`qname_id` でキー付け。                         |
| `alf_content_data`    | ノード（`cm:content` プロパティ `long_value` 経由）とコンテンツURLレコードを結ぶ。`content_url_id`・`content_mimetype_id` を持つ。                   |
| `alf_content_url`     | 物理ファイルURL: `content_url`（例: `store://2024/1/15/10/30/uuid.bin`）と `content_size`（バイト）。                                                |
| `alf_qname`           | 修飾プロパティ名・型名。`local_name` = 名前部分（例: `name`・`title`・`content`・`site`）。                                                          |
| `alf_namespace`       | 名前空間URI。`ns_id` で `alf_qname` と結合。                                                                                                         |
| `alf_mimetype`        | MIMEタイプ文字列（例: `application/pdf`）。`alf_content_data.content_mimetype_id` 経由で結合。                                                       |
| `alf_node_assoc`      | ピア（非包含）アソシエーション。ショートカット解決（`app:linkedNode`）で使用。                                                                       |

### 4.2 名前空間定数

```python
NS_CM  = "http://www.alfresco.org/model/content/1.0"    # cm: プレフィックス
NS_ST  = "http://www.alfresco.org/model/site/1.0"       # st: プレフィックス
NS_SYS = "http://www.alfresco.org/model/system/1.0"     # sys: プレフィックス
NS_APP = "http://www.alfresco.org/model/application/1.0" # app: プレフィックス
```

### 4.3 サイトの検索方法

サイトは `st:site` 型のノードです。`alf_node` を `type_qname.local_name = 'site'` かつ `type_ns.uri = NS_ST` でフィルタします。`cm:name` プロパティがサイトのスラッグ（短縮名）、`cm:title` が表示タイトルです。

```sql
-- 簡略例: 全 st:site ノードを検索
SELECT n.id, n.uuid, prop_name.string_value AS short_name
FROM alf_node n
JOIN alf_qname type_qname ON n.type_qname_id = type_qname.id
JOIN alf_namespace type_ns ON type_qname.ns_id = type_ns.id
LEFT JOIN alf_node_properties prop_name ON ...  -- cm:name
WHERE type_ns.uri = 'http://www.alfresco.org/model/site/1.0'
  AND type_qname.local_name = 'site'
```

### 4.4 documentLibrary の特定

ドキュメントライブラリのルートは、`alf_child_assoc` でサイトノードの子として `child_node_name = 'documentlibrary'`（大文字小文字不問）で識別されます。

### 4.5 ファイルノード列挙（再帰CTE）

全ファイルノードは **再帰CTE** を使って `alf_child_assoc`（`cm:contains` 型かつ `is_primary=TRUE`）を最大50階層走査して取得します。`alf_content_data` と `alf_content_url` に結合し、実際のコンテンツURL（実ファイル）を持つノードのみ返します。

### 4.6 コンテンツストアURL → 物理パス

全ファイルは以下のような `content_url` を持ちます：

```
store://2024/1/15/10/30/a1b2c3d4-uuid.bin
```

`store://` プレフィックスを取り除き、`{ALF_DATA_PATH}/contentstore/` を先頭に付けます：

```
{ALF_DATA_PATH}/contentstore/2024/1/15/10/30/a1b2c3d4-uuid.bin
```

### 4.7 ファイルごとに取得するノードプロパティ

| Alfrescoプロパティ | ソース                                     | 格納先                   |
| ------------------ | ------------------------------------------ | ------------------------ |
| `cm:name`          | `alf_node_properties.string_value`         | `file_name`、`full_path` |
| `cm:title`         | `alf_node_properties.string_value`         | `title`                  |
| `cm:description`   | `alf_node_properties.string_value`         | `description`            |
| `cm:versionLabel`  | `alf_node_properties.string_value`         | `version`                |
| `audit_creator`    | `alf_node` 直接カラム                      | `creator`                |
| `audit_created`    | `alf_node` 直接カラム                      | `created_at`             |
| `audit_modifier`   | `alf_node` 直接カラム                      | `modifier`               |
| `audit_modified`   | `alf_node` 直接カラム                      | `modified_at`            |
| MIMEタイプ         | `alf_content_data` 経由の `alf_mimetype`   | `mime_type`              |
| ファイルサイズ     | `alf_content_url.content_size`             | `file_size_bytes`        |
| タグ               | タギングアスペクト経由の `alf_child_assoc` | `tags`（カンマ区切り）   |

### 4.8 ショートカット解決（app:filelink / app:folderlink）

Alfrescoは「ショートカット」（`app:filelink` と `app:folderlink` 型ノード）をサポートします。本システムはこれを透過的に解決します：

- **`app:filelink`**: 物理コンテンツはターゲットノードから取得し、エクスポートのパスはショートカット自身のツリー上の位置を使用。
- **`app:folderlink`**: ターゲットフォルダをサブツリーとして再帰走査。パスはサイトツリー内のショートカットフォルダのパスをプレフィックスとして付与。
- **循環検出**: `_visited` セットにより、循環ショートカット参照による無限ループを防止。

### 4.9 パスの構築

`path_builder.py` は `alf_child_assoc` を上方向に走査してノードの完全パスを構築します：

```
child_node_id → parent_node_id → ... → doclibルート
```

各ステップで `child_node_name` を収集し、逆順に並べることで完全パスを生成します（例: `/Marketing/Reports/Q4/file.pdf`）。

同一親ノードへの重複クエリを避けるため、セッション内でキャッシュされます。

---

## 5. フェーズ1 — スキャン（抽出）

**エントリポイント:** `extract_site_task(job_id)` → `run_extraction(job_id, db)`

**処理手順:**

1. `job.status = scanning` に設定。
2. Alfresco PG セッションをオープン。
3. サイトノードと `documentLibrary` 子ノードを特定。
4. ジョブスコープに基づいてファイルノードを列挙：
   - **全ファイル**: documentLibrary ルートから再帰CTE。
   - **選択フォルダ**: 各選択フォルダノードから再帰CTE。
   - **選択ファイル**: node_id リストで直接参照。
   - **混在**: フォルダサブツリーと個別ファイルのユニオン（`node_id` で重複排除）。
   - **除外ファイル**: スキャン前に結果から除外。
5. 各ファイルノードに対して（再開可能性のため既存 `node_ref` はスキップ）：
   - プロパティ・監査情報・MIMEタイプ・タグを取得。
   - `path_builder` でパスを解決。
   - `FileRecord(status=pending)` をローカルPGに挿入。
   - メタデータCSVに1行書き込み。
   - 20件ごとにコミット（進捗ログ + DBフラッシュ）。
6. `job.status = scanned` に設定。

**出力:**

- ローカルPGの `file_records` 行（ファイルノードごとに1件）。
- `exports/{site}/metadata.csv`（行単位で随時更新）。

**再開可能性:** スキャン前にこの `job_id` の既存 `node_ref` 値をセットに読み込み、セット内にある場合はスキップ。どの時点から再起動しても安全。

---

## 6. フェーズ2 — ファイルコピー

**エントリポイント:** `copy_site_task(job_id)` → `run_copy(job_id, db)`

**処理手順:**

1. `job.status = copying` に設定、`copy_started_at` を記録。
2. `status IN ('pending', 'failed')` かつ `content_url IS NOT NULL` の `FileRecord` 行を全件取得。
3. 全レコードの `file_size_bytes` を事前にキャプチャ（SQLAlchemyのセッション期限切れによる競合状態を回避）。
4. `ThreadPoolExecutor(max_workers=copy_concurrency)` に全レコードを投入。デフォルト **8スレッド**。
5. 各フューチャーの完了時（`as_completed`）：
   - 成功時: `status=copied`・`local_export_path`・`transfer_speed_bps` を設定。
   - 失敗時: `status=failed`・`error_msg` を設定。
   - ファイルごとにコミット（フロントエンドがリアルタイムで進捗を確認可能）。
   - 10件の完了ごとに一時停止シグナルを確認。
6. **ループ後の照合**: `local_export_path` が設定されているが `status=pending` のまま残っているレコード（ORMの期限切れ競合状態で発生）を `copied` に修正。
7. `content_url` のない残り `pending` レコードを `skipped` に設定。
8. DBから最終的なメタデータCSVを再生成。
9. `job.status = done`（失敗ファイルがあれば `failed`）に設定。

**ファイルコピー方式:**

- ソース: `{ALF_DATA_PATH}/contentstore/{相対パス}`（`content_url` から解決）。
- コピー先: `exports/{site_name}/files/{フォルダ階層}/{元ファイル名.拡張子}`。
- 名前内の使用不可文字（`\ / : * ? " < > |`）は `_` に置換。
- タイムスタンプを保持する `shutil.copy2()` を使用。

**並行処理設定:**

```ini
COPY_CONCURRENCY=8  # スレッド数（プロセスではない — I/Oバウンド処理に適切）
```

**速度計測:** `transfer_speed_bps = file_size_bytes / 経過秒数` をファイルごとに記録し、フロントエンドで表示。

---

## 7. フェーズ3 — マイグレーション

**エントリポイント:** `migrate_site_task(job_id)` → `tasks.py` 内インライン

**処理手順:**

1. `job.status = migrating` に設定、`migration_started_at` を記録。
2. このジョブの `status = copied` の全 `FileRecord` 行を取得。
3. 未追跡のコピー済みレコードに対して `MigrationRecord(status=pending)` 行を事前作成。
4. 各 `FileRecord` に対して：
   a. **ジョブ状態確認** — `migrating` 以外の場合は即座に停止（一時停止・差し戻し対応）。
   b. **重複確認** — ターゲットDBを照会: `SELECT id, uuid_filename FROM files WHERE source_node_ref = :nr`。
   - 見つかった場合: `MigrationRecord.status = skipped` に設定し、既存の `target_file_id` を再利用。ファイルコピーなし。
   - 見つからない場合: 挿入処理に進む。
     c. **フォルダパス作成**: `parse_folder_parts(full_path)` を走査し、`ensure_folder_path()` でターゲットDBにフォルダ行を作成・再利用。サイト名は常にルートフォルダ。
     d. **ファイルマイグレーション**:
   - 新しい UUID4 ファイル名を生成（拡張子は保持）。
   - `src` → `target-storage/{uuid}.ext` にハードリンク（クロスファイルシステムの場合は `shutil.copy2` にフォールバック）。
   - 全メタデータを付けてターゲット `files` テーブルに INSERT。
   - `(target_file_id, uuid_filename, is_duplicate)` の3タプルを返す。
     e. `MigrationRecord` を結果で更新: `status=migrated`・`target_file_id`・`target_folder_id`・`uuid_filename`・`migrated_at`・`duration_ms`。
     f. ファイルごとにコミット。
5. 全件成功: `job.status = migrated`。失敗あり: `job.status = failed`。

**ハードリンク vs コピー:**

- `os.link(src, dest)` — 瞬時、同じiノードを共有。ディスク容量は倍増しない。
- `OSError`（クロスボリューム・クロスドライブ等）の場合は `shutil.copy2()` にフォールバック。
- どちらのパスも同じデータを参照する。片方を削除しても他方は影響を受けない。

**フォルダの重複排除:**
`ensure_folder_path()` は各 INSERT 前に SELECT を実行します。競合状態（並行ジョブが同一フォルダを作成しようとする場合）では例外をキャッチし、ロールバック後に SELECT をリトライします。

**ターゲットDB スキーマ — folders:**

```sql
CREATE TABLE folders (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id  UUID REFERENCES folders(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- NULL安全な一意性（PostgreSQLのUNIQUE制約ではNULL != NULL）:
CREATE UNIQUE INDEX idx_folders_root_unique ON folders(name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX idx_folders_child_unique ON folders(parent_id, name) WHERE parent_id IS NOT NULL;
```

**ターゲットDB スキーマ — files:**

```sql
CREATE TABLE files (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id        UUID REFERENCES folders(id) ON DELETE SET NULL,
    uuid_filename    VARCHAR(300) NOT NULL,
    original_name    VARCHAR(500) NOT NULL,
    title            VARCHAR(500),
    description      TEXT,
    mime_type        VARCHAR(100),
    file_size_bytes  BIGINT,
    creator          VARCHAR(255),
    modifier         VARCHAR(255),
    created_at       TIMESTAMP,
    modified_at      TIMESTAMP,
    tags             TEXT,
    source_node_ref  VARCHAR(255),  -- Alfresco の workspace://SpacesStore/{uuid}
    source_site      VARCHAR(255),
    migrated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_files_source_node_ref ON files(source_node_ref)
    WHERE source_node_ref IS NOT NULL;
```

---

## 8. ジョブライフサイクルと状態遷移

```
[API: POST /api/jobs]
       ↓
   created（作成済み）
       ↓  (Celery: extract_site_task)
   scanning（スキャン中）
       ↓
   scanned（スキャン完了）─────────── （スキャン中に一時停止可能）
       ↓  (API: POST /jobs/{id}/start-copy)
       ↓  (Celery: copy_site_task)
   copying（コピー中）
       ↓
   done（コピー完了）──────────────── （マイグレーション開始可能）
       ↓  (API: POST /jobs/{id}/migrate)
       ↓  (Celery: migrate_site_task)
   migrating（マイグレーション中）
       ↓
   migrated（マイグレーション完了）

アクティブフェーズ中: → paused（一時停止）（API pauseエンドポイント）
paused/failed から:   → resume（再開）（API resumeエンドポイント）
任意フェーズ:         → failed（回復不能エラー）
```

**`FileRecord.status` 値:**

| ステータス | 意味                                             |
| ---------- | ------------------------------------------------ |
| `pending`  | 未コピー                                         |
| `copied`   | `exports/` へのコピー成功                        |
| `failed`   | コピー失敗（`error_msg` 参照）                   |
| `skipped`  | コンテンツURLなし — 物理ファイルを持たないノード |

**`MigrationRecord.status` 値:**

| ステータス | 意味                                                                  |
| ---------- | --------------------------------------------------------------------- |
| `pending`  | 事前作成済み；マイグレーション待ち                                    |
| `migrated` | ターゲットDBへの挿入成功 + ファイルリンク完了                         |
| `failed`   | このファイルのマイグレーション失敗（`error_msg` 参照）                |
| `skipped`  | `local_export_path` なし、または `source_node_ref` がターゲットに既存 |

---

## 9. 並行処理・マルチジョブ対応

### Celery ワーカープール

```python
# celery_app.py
worker_pool = "threads"   # Windows対応；実際の並行処理をサポート
worker_prefetch_multiplier = 1  # ワーカースロットあたり1タスク
```

ワーカーは `--concurrency=2`（docker-compose）で起動し、**2つの Celery タスクが同時に実行可能**です。各タスク（スキャン・コピー・マイグレーション）は独立して実行されます。

- 2つの異なるジョブが同時に進行可能（例: ジョブAがコピー中にジョブBがスキャン）。
- 同一サイトの2つのジョブも同時実行可能 — システムはサイトスコープではなくジョブスコープ。

### コピー内部のスレッドプール

各コピータスクは内部で `ThreadPoolExecutor(max_workers=8)` を追加使用。単一のコピージョブが既に8スレッドを使用。

Celeryレベルで `--concurrency=2` の場合、2つのジョブが同時実行されると合計で **最大16の並行ファイルコピースレッド** が動作します。

### SQLAlchemy セッションの安全性

各 Celery タスクは独自の `LocalSession()` を作成します。同じ PostgreSQL 接続プール（`pool_size=5, max_overflow=10`）を共有しますが、独立したトランザクションコンテキストを持ちます。タスク間に共有可変状態はありません。

---

## 10. 一時停止・再開の仕組み

### 一時停止

1. **API**: `POST /api/jobs/{id}/migration/pause`（またはコピーフェーズの `/pause`）でDBの `job.status = paused` に設定。
2. **Celery タスク失効**: ベストエフォートとして `celery_app.control.revoke(celery_task_id, terminate=True)` を送信。
3. **タスク自己チェック**: マイグレーションタスクは **ファイルごと** に `job.status` を確認。`migrating` 以外の場合は即座にリターン。コピータスクは10件の完了ごとに確認（部分バッチを先にコミット）。

### 再開

- **API**: `POST /api/jobs/{id}/migration/resume` で新しい `migrate_site_task` をディスパッチ。
- タスクは既に `migrated` の `MigrationRecord` 行をスキップ（べき等）。
- コピー再開の場合: `status IN ('pending', 'failed')` のレコードのみ処理。

### 差し戻し（Revert）

1. `POST /api/jobs/{id}/migration`（DELETE）— `migrating` でない場合のみ許可。
2. 残存する Celery タスクを失効。
3. `revert_migration()`:
   - ターゲットDB の `migrated` 状態の `files` 行を削除。
   - `target-storage/` から UUID ファイルを削除。
   - 空になったフォルダを親チェーンを遡りながら削除。
   - このジョブの全 `MigrationRecord` 行を削除。
4. `job.status = done` にリセット。

---

## 11. 重複防止

### ジョブ間のファイル重複排除（マイグレーション）

ターゲットDBにファイルを挿入する前に、`migrate_file_record()` が確認します：

```sql
SELECT id::text, uuid_filename FROM files
WHERE source_node_ref = :node_ref LIMIT 1
```

- `source_node_ref` = `workspace://SpacesStore/{uuid}` — Alfresco ノードごとに一意。
- 一致が見つかった場合: **挿入なし、ファイルコピーなし**。既存の `target_file_id` を再利用。
- `MigrationRecord.status` を「別のジョブから既にマイグレーション済み」のメッセージで `skipped` に設定。

同一サイト（またはフォルダ選択が重複する）で2つのジョブを実行しても、ターゲットシステムに重複ファイルは作成されません。

### データベース制約

```sql
CREATE UNIQUE INDEX idx_files_source_node_ref
    ON files(source_node_ref) WHERE source_node_ref IS NOT NULL;
```

アプリケーションチェックがバイパスされても、DBレベルで一意性を保証。

### ジョブ内の重複排除（スキャン）

スキャン中、`existing_node_refs` を事前にロードし、この `job_id` に対して既に記録されているノードをスキップします：

```python
if node_ref in existing_node_refs:
    continue
```

### ジョブ内の重複排除（複数フォルダ選択）

ユーザーが重複するサブツリーを含む複数フォルダを選択した場合（またはフォルダとその中の個別ファイルを同時選択）、エクストラクターは `seen_ids` セットを使って `FileRecord` 書き込み前に重複排除します。

---

## 12. 再開可能性とべき等性

3つのフェーズすべてが完全にべき等です：

| フェーズ         | 再開メカニズム                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| スキャン         | この `job_id` の `file_records` に既にある `node_ref` をスキップ                                          |
| コピー           | `status IN ('pending', 'failed')` のレコードのみ処理                                                      |
| マイグレーション | 既に `migrated` の `MigrationRecord` 行をスキップ；`source_node_ref` で既存のターゲットファイルをスキップ |

タスクを再キュー（クラッシュ後など）しても、処理済みの部分から継続されます。Celery 設定の `task_acks_late=True` と `task_reject_on_worker_lost=True` により、ワーカーが実行中に死亡した場合もタスクが再キューされます。

---

## 13. 設定リファレンス

全設定は環境変数（`.env` ファイルまたは `env/backend.env`）で行います：

| 変数                  | デフォルト                                                         | 説明                                                             |
| --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `ALFRESCO_DB_URL`     | —                                                                  | **必須。** Alfresco PostgreSQL 接続URL（読み取り専用）。         |
| `ALF_DATA_PATH`       | —                                                                  | **必須。** ホスト上の Alfresco `alf_data` ディレクトリへのパス。 |
| `LOCAL_DB_URL`        | `postgresql://aes_user:aes_pass@localhost:5432/aes_tracking`       | ローカル追跡DB URL。                                             |
| `REDIS_URL`           | `redis://localhost:6379/0`                                         | Celery 用 Redis URL。                                            |
| `EXPORT_DIR`          | `./exports`                                                        | 抽出ファイルの書き込み先ディレクトリ。                           |
| `TARGET_DB_URL`       | `postgresql://target_user:target_pass@target_db:5432/target_files` | マイグレーション先DB URL。                                       |
| `TARGET_STORAGE_PATH` | `/app/target-storage`                                              | ターゲットシステムのUUID名ファイル格納ディレクトリ。             |
| `COPY_CONCURRENCY`    | `8`                                                                | コピージョブあたりの最大並行ファイルコピースレッド数。           |

---

## 14. ファイルパス解決

### ソース（Alfresco → exports/）

```
content_url:  store://2024/1/15/10/30/a1b2c3d4.bin
              ↓ "store://" を除去
相対パス:     2024/1/15/10/30/a1b2c3d4.bin
              ↓ ALF_DATA_PATH/contentstore/ を先頭に付加
ソース:       {ALF_DATA_PATH}/contentstore/2024/1/15/10/30/a1b2c3d4.bin
```

### コピー先（exports/）

```
full_path:    /Marketing/Reports/Q4/budget.xlsx
              ↓ 分割し、最後のセグメント（ファイル名）を除外
フォルダ:     ["Marketing", "Reports", "Q4"]
              ↓ 各セグメントの安全な名前化（使用不可文字を _ に置換）
コピー先:     {EXPORT_DIR}/{site_name}/files/Marketing/Reports/Q4/budget.xlsx
```

### マイグレーション（exports/ → target-storage/）

```
local_export_path:  {EXPORT_DIR}/{site}/files/Marketing/Reports/Q4/budget.xlsx
                    ↓ UUID4 を生成
uuid_filename:      550e8400-e29b-41d4-a716-446655440000.xlsx
                    ↓ os.link()（ハードリンク）または shutil.copy2()（クロスボリュームのフォールバック）
target-storage:     {TARGET_STORAGE_PATH}/550e8400-e29b-41d4-a716-446655440000.xlsx
```

`full_path` はターゲットDB内のフォルダ階層構築にも使用されます：

```
/Marketing/Reports/Q4/budget.xlsx
→ フォルダ部分: ["Marketing", "Reports", "Q4"]
→ ターゲットフォルダ: {site_name} → Marketing → Reports → Q4
→ 末端の folder_id を files テーブルの INSERT で使用
```
