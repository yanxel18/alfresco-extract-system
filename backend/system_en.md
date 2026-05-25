# Alfresco Extract System — Backend Technical Reference

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture & Components](#2-architecture--components)
3. [Database Connections](#3-database-connections)
4. [Alfresco PostgreSQL — Tables & Queries](#4-alfresco-postgresql--tables--queries)
5. [Phase 1 — Scan (Extraction)](#5-phase-1--scan-extraction)
6. [Phase 2 — File Copy](#6-phase-2--file-copy)
7. [Phase 3 — Migration](#7-phase-3--migration)
8. [Job Lifecycle & State Machine](#8-job-lifecycle--state-machine)
9. [Concurrency & Multi-Job Support](#9-concurrency--multi-job-support)
10. [Pause & Resume Mechanics](#10-pause--resume-mechanics)
11. [Duplicate Prevention](#11-duplicate-prevention)
12. [Resumability & Idempotency](#12-resumability--idempotency)
13. [Configuration Reference](#13-configuration-reference)
14. [File Path Resolution](#14-file-path-resolution)

---

## 1. System Overview

This system extracts all files and metadata from **Alfresco Community Edition** sites by:

1. **Scanning** the Alfresco PostgreSQL database to enumerate all file nodes.
2. **Copying** the physical content files from the Alfresco contentstore to a local `exports/` directory, preserving original names and folder hierarchy.
3. **Migrating** the exported files into a target file-manager database — inserting folder/file rows and renaming files to UUIDs in `target-storage/`.

The system is designed for bulk migration of 50,000+ mixed files (video, images, PDFs, Office docs, etc.) with full resumability — jobs can be paused and resumed without re-processing already-completed files.

---

## 2. Architecture & Components

```
FastAPI (uvicorn:8000)
  ├── /api/sites      — list Alfresco sites
  ├── /api/sites/{name}/browse — browse folder tree
  ├── /api/jobs       — CRUD for extraction jobs
  ├── /api/jobs/{id}  — job detail, file records
  └── /api/jobs/{id}/migrate — migration control

Celery Worker (worker.celery_app)
  ├── tasks.extract_site_task  — Phase 1
  ├── tasks.copy_site_task     — Phase 2
  └── tasks.migrate_site_task  — Phase 3

Redis — Celery broker + result backend
Local PostgreSQL (aes_tracking) — job tracking DB
Alfresco PostgreSQL (read-only) — source metadata
Target PostgreSQL — migration destination
```

**Key source files:**

| File                                | Responsibility                                            |
| ----------------------------------- | --------------------------------------------------------- |
| `app/services/alfresco_db.py`       | ALL raw SQL against Alfresco PG — no inline SQL elsewhere |
| `app/services/extractor.py`         | Phase 1 scan logic                                        |
| `app/services/file_copier.py`       | Phase 2 copy logic                                        |
| `app/services/migration_service.py` | Phase 3 migration logic                                   |
| `app/services/path_builder.py`      | Path resolution via alf_child_assoc                       |
| `worker/tasks.py`                   | Celery task wrappers for all 3 phases                     |
| `app/models/job.py`                 | Job + FileRecord ORM models                               |
| `app/models/migration.py`           | MigrationRecord ORM model                                 |
| `app/config.py`                     | Pydantic Settings (env-driven)                            |

---

## 3. Database Connections

### 3.1 Alfresco PostgreSQL (read-only)

- **Purpose:** Source of all file metadata and content URL references.
- **Access:** Read-only. Never written to. Uses raw SQL via `text()` — no ORM models mapped to `alf_*` tables.
- **Connection:** Managed by `app/db/alfresco.py` via SQLAlchemy engine with `pool_pre_ping=True`.
- **Session lifecycle:** Opened for the duration of a Phase 1 scan, then closed. Never held open during Phase 2 or 3.
- **Deployment note:** When the backend runs in Docker against an external Alfresco PostgreSQL server, `pg_hba.conf` must allow the Docker container subnet. A DB client running on the Windows host may succeed while the container is still rejected.

```python
# config.py
alfresco_db_url: str  # e.g. postgresql://alfresco:alfresco@localhost:5432/alfresco
```

### 3.2 Local PostgreSQL — `aes_tracking`

- **Purpose:** Stores all `jobs`, `file_records`, and `migration_records`. The source of truth for job state.
- **Access:** Read-write. SQLAlchemy ORM.
- **Pool:** `pool_size=5`, `max_overflow=10`.
- **Sessions in FastAPI:** Injected via `Depends(get_local_db)` — auto-closed after each request.
- **Sessions in Celery:** Opened manually at task start, closed in `finally` block.

```python
local_db_url: str  # e.g. postgresql://aes_user:aes_pass@localhost:5432/aes_tracking
```

### 3.3 Target PostgreSQL — `target_files`

- **Purpose:** Migration destination. Stores `folders` and `files` rows representing the final structure in the new file-manager system.
- **Access:** Read-write. Raw SQL via `text()`.
- **Session lifecycle:** Opened at the start of `migrate_site_task`, closed in `finally`. A separate session from the local DB to allow independent transaction control (rollback one without affecting the other).

```python
target_db_url: str  # e.g. postgresql://target_user:target_pass@target_db:5432/target_files
```

### 3.4 Redis

- **Purpose:** Celery message broker and task result backend.
- **Result expiry:** 7 days (`result_expires=86400 * 7`).

---

## 4. Alfresco PostgreSQL — Tables & Queries

### 4.1 Key Tables

| Table                 | Purpose                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alf_store`           | Workspace stores (SpacesStore)                                                                                                                                          |
| `alf_node`            | Every node (files, folders, sites). Has `id`, `uuid`, `type_qname_id`, `audit_creator`, `audit_created`, `audit_modifier`, `audit_modified`.                            |
| `alf_child_assoc`     | Parent→child relationships. `type_qname_id` = `cm:contains` for normal tree traversal. `child_node_name` = the node's name. `is_primary=TRUE` for the canonical parent. |
| `alf_node_properties` | All metadata values — `string_value`, `long_value`, `float_value`, `boolean_value`, `serializable_value`. Keyed by `qname_id`.                                          |
| `alf_content_data`    | Links node (via `cm:content` property `long_value`) to a content URL record. Has `content_url_id`, `content_mimetype_id`.                                               |
| `alf_content_url`     | Physical file URL: `content_url` (e.g. `store://2024/1/15/10/30/uuid.bin`) and `content_size` in bytes.                                                                 |
| `alf_qname`           | Qualified property/type names. `local_name` = the name part (e.g. `name`, `title`, `content`, `site`).                                                                  |
| `alf_namespace`       | Namespace URIs. Joined with `alf_qname` via `ns_id`.                                                                                                                    |
| `alf_mimetype`        | MIME type strings (e.g. `application/pdf`). Joined via `alf_content_data.content_mimetype_id`.                                                                          |
| `alf_node_assoc`      | Peer (non-containment) associations. Used for shortcut resolution (`app:linkedNode`).                                                                                   |

### 4.2 Namespace Constants

```python
NS_CM  = "http://www.alfresco.org/model/content/1.0"    # cm: prefix
NS_ST  = "http://www.alfresco.org/model/site/1.0"       # st: prefix
NS_SYS = "http://www.alfresco.org/model/system/1.0"     # sys: prefix
NS_APP = "http://www.alfresco.org/model/application/1.0" # app: prefix
```

### 4.3 How Sites Are Found

Sites are `st:site` typed nodes. Query filters `alf_node` where `type_qname.local_name = 'site'` and `type_ns.uri = NS_ST`. The `cm:name` property gives the site short name (slug), `cm:title` gives the display title.

```sql
-- Simplified: find all st:site nodes
SELECT n.id, n.uuid, prop_name.string_value AS short_name
FROM alf_node n
JOIN alf_qname type_qname ON n.type_qname_id = type_qname.id
JOIN alf_namespace type_ns ON type_qname.ns_id = type_ns.id
LEFT JOIN alf_node_properties prop_name ON ...  -- cm:name
WHERE type_ns.uri = 'http://www.alfresco.org/model/site/1.0'
  AND type_qname.local_name = 'site'
```

### 4.4 documentLibrary Lookup

The document library root is a child of the site node with `child_node_name = 'documentlibrary'` (case-insensitive) in `alf_child_assoc`.

### 4.5 File Node Enumeration (Recursive CTE)

All file nodes are found using a **recursive CTE** that walks `alf_child_assoc` (only `cm:contains` type, `is_primary=TRUE`) up to 50 levels deep. Nodes are joined to `alf_content_data` and `alf_content_url` — only nodes with an actual content URL (i.e. real files, not folders) are returned.

### 4.6 Content Store URL → Physical Path

Every file has a `content_url` like:

```
store://2024/1/15/10/30/a1b2c3d4-uuid.bin
```

Strip the `store://` prefix and prepend `{ALF_DATA_PATH}/contentstore/`:

```
{ALF_DATA_PATH}/contentstore/2024/1/15/10/30/a1b2c3d4-uuid.bin
```

### 4.7 Node Properties Fetched Per File

| Alfresco Property | Source                                | Stored In                |
| ----------------- | ------------------------------------- | ------------------------ |
| `cm:name`         | `alf_node_properties.string_value`    | `file_name`, `full_path` |
| `cm:title`        | `alf_node_properties.string_value`    | `title`                  |
| `cm:description`  | `alf_node_properties.string_value`    | `description`            |
| `cm:versionLabel` | `alf_node_properties.string_value`    | `version`                |
| `audit_creator`   | `alf_node` direct column              | `creator`                |
| `audit_created`   | `alf_node` direct column              | `created_at`             |
| `audit_modifier`  | `alf_node` direct column              | `modifier`               |
| `audit_modified`  | `alf_node` direct column              | `modified_at`            |
| MIME type         | `alf_mimetype` via `alf_content_data` | `mime_type`              |
| File size         | `alf_content_url.content_size`        | `file_size_bytes`        |
| Tags              | `alf_child_assoc` via tagging aspect  | `tags` (comma-separated) |

### 4.8 Shortcut Resolution (app:filelink / app:folderlink)

Alfresco supports shortcut-like nodes such as `app:filelink` and `app:folderlink`. In practice, deployments may store their target in either:

- `app:linkedNode` peer associations, or
- legacy `cm:destination` NodeRef properties.

The system now handles these conservatively:

- **File-target shortcuts**: If the resolved target has real `cm:content`, the entry can be surfaced as a file.
- **Folder-target shortcuts**: The browse API exposes them as shortcuts for visibility, but does **not** expand them inline or extract them as if they were real child folders.
- **Operator safety goal**: Avoid implying that a target folder physically exists under the shortcut's current Alfresco path.

### 4.9 Path Building

`path_builder.py` builds the full path for a node by walking `alf_child_assoc` upward:

```
child_node_id → parent_node_id → ... → doclib root
```

At each step, `child_node_name` is collected. The collected names are reversed to form the full path, e.g. `/Marketing/Reports/Q4/file.pdf`.

Results are cached per-session (`functools.lru_cache` style) to avoid re-querying the same parent nodes repeatedly during a scan.

---

## 5. Phase 1 — Scan (Extraction)

**Entry point:** `extract_site_task(job_id)` → `run_extraction(job_id, db)`

**Steps:**

1. Set `job.status = scanning`.
2. Open Alfresco PG session.
3. Locate site node and `documentLibrary` child node.
4. Enumerate file nodes based on job scope:
   - **All files**: recursive CTE from documentLibrary root.
   - **Selected folders**: recursive CTE from each selected folder node.
   - **Selected files**: direct lookup by node_id list.
   - **Mixed**: union of folder subtrees + individual files, deduplicated by `node_id`.
   - **Excluded files**: filtered out from the result before scanning.
5. For each file node (skipping already-recorded `node_ref`s for resumability):
   - Fetch properties, audit info, MIME type, tags.
   - Resolve path via `path_builder`.
   - Insert `FileRecord(status=pending)` into local PG.
   - Write one row to metadata CSV.
   - Commit every 20 files (progress logging + DB flush).
6. Set `job.status = scanned`.

**Output:**

- `file_records` rows in local PG (one per file node).
- `exports/{site}/metadata.csv` (partial; updated row-by-row).

**Resumability:** Before scanning, all existing `node_ref` values for this `job_id` are loaded into a set. Any file already in the set is skipped. Safe to restart from any point.

---

## 6. Phase 2 — File Copy

**Entry point:** `copy_site_task(job_id)` → `run_copy(job_id, db)`

**Steps:**

1. Set `job.status = copying`, record `copy_started_at`.
2. Query all `FileRecord` rows with `status IN ('pending', 'failed')` and `content_url IS NOT NULL`.
3. Pre-capture `file_size_bytes` for all records (avoids SQLAlchemy session-expiry race conditions where lazy-loading an expired attribute can overwrite pending attribute changes).
4. Submit all records to a `ThreadPoolExecutor(max_workers=copy_concurrency)` — default **8 threads**.
5. As each future completes (`as_completed`):
   - On success: set `status=copied`, `local_export_path`, `transfer_speed_bps`.
   - On failure: set `status=failed`, `error_msg`.
   - Commit per-file so frontend sees live progress.

**Remote SMB/CIFS note:** When `alf_data/contentstore` is mounted from a remote Windows share into Docker, stability matters more than raw throughput. The copy helper uses streamed copy with retry for transient read errors, and production deployments should usually set `COPY_CONCURRENCY=1`.

- Check pause signal every 10 completions.

6. **Post-loop reconciliation**: Any record with `local_export_path` set but `status=pending` (missed due to ORM expiry race) is corrected to `copied`.
7. Mark remaining `pending` records with no `content_url` as `skipped`.
8. Regenerate final metadata CSV from DB.
9. Set `job.status = done` (or `failed` if any file failed).

**File Copy Mechanism:**

- Source: `{ALF_DATA_PATH}/contentstore/{relative_path}` (resolved from `content_url`).
- Destination: `exports/{site_name}/files/{folder_hierarchy}/{original_name.ext}`.
- Unsafe characters in names (`\ / : * ? " < > |`) are replaced with `_`.
- Uses `shutil.copy2()` which preserves file timestamps.

**Concurrency setting:**

```ini
COPY_CONCURRENCY=8  # threads, not processes — safe for I/O-bound work
```

**Speed measurement:** `transfer_speed_bps = file_size_bytes / elapsed_seconds` stored per file for frontend display.

---

## 7. Phase 3 — Migration

**Entry point:** `migrate_site_task(job_id)` → inline in `tasks.py`

**Steps:**

1. Set `job.status = migrating`, record `migration_started_at`.
2. Query all `FileRecord` rows with `status = copied` for this job.
3. Pre-create `MigrationRecord(status=pending)` rows for all copied records not yet tracked.
4. For each `FileRecord`:
   a. **Check job status** — if not `migrating`, stop immediately (handles pause/revert).
   b. **Duplicate check** — query target DB: `SELECT id, uuid_filename FROM files WHERE source_node_ref = :nr`.
   - If found: mark `MigrationRecord.status = skipped`, reuse existing `target_file_id`. No file copy.
   - If not found: proceed with insert.
     c. **Folder path creation**: Walk `parse_folder_parts(full_path)` and call `ensure_folder_path()` which creates/reuses folder rows in the target DB. Site name is always the root folder.
     d. **File migration**:
   - Generate a new UUID4 filename (preserving extension).
   - Hard-link `src` → `target-storage/{uuid}.ext` (falls back to `shutil.copy2` if cross-filesystem).
   - INSERT into target `files` table with all metadata.
   - Returns `(target_file_id, uuid_filename, is_duplicate)`.
     e. Update `MigrationRecord` with result: `status=migrated`, `target_file_id`, `target_folder_id`, `uuid_filename`, `migrated_at`, `duration_ms`.
     f. Commit after each file.
5. If all succeeded: `job.status = migrated`. If any failed: `job.status = failed`.

**Hard-link vs copy:**

- `os.link(src, dest)` — instantaneous, shares inode. No disk space doubled.
- Falls back to `shutil.copy2()` only if `OSError` (e.g. cross-volume/cross-drive).
- Both paths refer to the same bytes; deleting one leaves the other intact.

**Folder deduplication:**
`ensure_folder_path()` does a SELECT before each INSERT. On race conditions (concurrent jobs creating the same folder), it catches the exception, rolls back, and retries the SELECT.

**Target DB schema — folders:**

```sql
CREATE TABLE folders (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id  UUID REFERENCES folders(id) ON DELETE CASCADE,
    name       VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
-- NULL-safe uniqueness (NULL != NULL in PostgreSQL UNIQUE constraints):
CREATE UNIQUE INDEX idx_folders_root_unique ON folders(name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX idx_folders_child_unique ON folders(parent_id, name) WHERE parent_id IS NOT NULL;
```

**Target DB schema — files:**

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
    source_node_ref  VARCHAR(255),  -- Alfresco workspace://SpacesStore/{uuid}
    source_site      VARCHAR(255),
    migrated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_files_source_node_ref ON files(source_node_ref)
    WHERE source_node_ref IS NOT NULL;
```

---

## 8. Job Lifecycle & State Machine

```
[API: POST /api/jobs]
       ↓
   created
       ↓  (Celery: extract_site_task)
   scanning
       ↓
   scanned ──────────────────────────── (can pause during scan)
       ↓  (API: POST /jobs/{id}/start-copy)
       ↓  (Celery: copy_site_task)
   copying
       ↓
   done ─────────────────────────────── (can start migration)
       ↓  (API: POST /jobs/{id}/migrate)
       ↓  (Celery: migrate_site_task)
   migrating
       ↓
   migrated

At any active phase: → paused (API pause endpoint)
From paused/failed:  → resume (API resume endpoint)
From any phase:      → failed (unrecoverable error)
```

**`FileRecord.status` values:**

| Status    | Meaning                                    |
| --------- | ------------------------------------------ |
| `pending` | Not yet copied                             |
| `copied`  | Successfully copied to `exports/`          |
| `failed`  | Copy failed (see `error_msg`)              |
| `skipped` | No content URL — node has no physical file |

**`MigrationRecord.status` values:**

| Status     | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `pending`  | Pre-created; waiting to be migrated                                      |
| `migrated` | Successfully inserted into target DB + file linked                       |
| `failed`   | Migration failed for this file (see `error_msg`)                         |
| `skipped`  | No `local_export_path`, or duplicate `source_node_ref` already in target |

---

## 9. Concurrency & Multi-Job Support

### Celery Worker Pool

```python
# celery_app.py
worker_pool = "threads"   # Windows-compatible; supports real concurrency
worker_prefetch_multiplier = 1  # One task at a time per worker slot
```

The worker is started with `--concurrency=2` (docker-compose), allowing **2 Celery tasks to run simultaneously**. Each task (scan, copy, or migration) runs independently.

This means:

- 2 different jobs can be in progress simultaneously (e.g. Job A copying while Job B scanning).
- 2 jobs from the same site can also run — the system is job-scoped, not site-scoped.

### Thread Pool Inside Copy

Each copy task additionally uses `ThreadPoolExecutor(max_workers=8)` internally for parallel I/O. So a single copy job already uses 8 threads internally.

With `--concurrency=2` at the Celery level, two jobs running simultaneously means up to **16 concurrent file copy threads** total.

### SQLAlchemy Session Safety

Each Celery task creates its own `LocalSession()` — they share the same PostgreSQL connection pool (`pool_size=5, max_overflow=10`) but have independent transaction contexts. No shared mutable state between tasks.

---

## 10. Pause & Resume Mechanics

### Pausing

1. **API**: `POST /api/jobs/{id}/migration/pause` (or `/pause` for copy phase) sets `job.status = paused` in DB.
2. **Celery task revocation**: `celery_app.control.revoke(celery_task_id, terminate=True)` is sent as a best-effort signal.
3. **Task self-check**: The migration task checks `job.status` on **every file** iteration. If status is not `migrating`, the task returns immediately. The copy task checks every 10 completions (partial batch is committed first).

### Resuming

- **API**: `POST /api/jobs/{id}/migration/resume` dispatches a new `migrate_site_task`.
- The task skips already-`migrated` `MigrationRecord` rows (idempotent).
- For copy resume: only `status IN ('pending', 'failed')` records are processed.

### Revert

1. `POST /api/jobs/{id}/migration` (DELETE) — only allowed when not `migrating`.
2. Revokes any lingering Celery task.
3. `revert_migration()`:
   - Deletes all `migrated` target DB `files` rows.
   - Deletes UUID files from `target-storage/`.
   - Prunes now-empty folders (bottom-up walk up the parent chain).
   - Deletes all `MigrationRecord` rows for the job.
4. Resets `job.status = done`.

---

## 11. Duplicate Prevention

### Cross-Job File Deduplication (Migration)

Before inserting a file into the target DB, `migrate_file_record()` checks:

```sql
SELECT id::text, uuid_filename FROM files
WHERE source_node_ref = :node_ref LIMIT 1
```

- `source_node_ref` = `workspace://SpacesStore/{uuid}` — unique per Alfresco node.
- If a match is found: **no insert, no file copy**. The existing `target_file_id` is reused.
- `MigrationRecord.status` is set to `skipped` with message "Already migrated from another job".

This means running two jobs for the same site (or overlapping folder selections) will not create duplicate files in the target system.

### Database Constraint

```sql
CREATE UNIQUE INDEX idx_files_source_node_ref
    ON files(source_node_ref) WHERE source_node_ref IS NOT NULL;
```

This enforces uniqueness at the DB level even if the application check is bypassed.

### Within-Job Deduplication (Scan)

During scanning, `existing_node_refs` is pre-loaded and any node already recorded for this `job_id` is skipped:

```python
if node_ref in existing_node_refs:
    continue
```

### Within-Job Deduplication (Multi-Folder Selection)

When the user selects multiple folders with overlapping subtrees (or selects both a folder and individual files within it), the extractor uses a `seen_ids` set to deduplicate before writing any `FileRecord` rows.

---

## 12. Resumability & Idempotency

All three phases are fully idempotent:

| Phase     | Resume mechanism                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------ |
| Scan      | Skip any `node_ref` already in `file_records` for this `job_id`                                        |
| Copy      | Only process `status IN ('pending', 'failed')` records                                                 |
| Migration | Skip `MigrationRecord` rows already `migrated`; skip target files already present by `source_node_ref` |

Tasks can be re-queued (e.g. after a crash) and will continue from where they left off. The Celery configuration `task_acks_late=True` and `task_reject_on_worker_lost=True` ensure tasks are re-queued if the worker dies mid-execution.

---

## 13. Configuration Reference

All config via environment variables (`.env` file or `env/backend.env`):

| Variable              | Default                                                            | Description                                                   |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `ALFRESCO_DB_URL`     | —                                                                  | **Required.** Alfresco PostgreSQL connection URL (read-only). |
| `ALF_DATA_PATH`       | —                                                                  | **Required.** Host path to Alfresco `alf_data` directory.     |
| `LOCAL_DB_URL`        | `postgresql://aes_user:aes_pass@localhost:5432/aes_tracking`       | Local tracking DB URL.                                        |
| `REDIS_URL`           | `redis://localhost:6379/0`                                         | Redis URL for Celery.                                         |
| `EXPORT_DIR`          | `./exports`                                                        | Directory where extracted files are written.                  |
| `TARGET_DB_URL`       | `postgresql://target_user:target_pass@target_db:5432/target_files` | Migration destination DB URL.                                 |
| `TARGET_STORAGE_PATH` | `/app/target-storage`                                              | Directory for UUID-named files in target system.              |
| `COPY_CONCURRENCY`    | `8`                                                                | Max concurrent file copy threads per copy job.                |

---

## 14. File Path Resolution

### Source (Alfresco → exports/)

```
content_url:  store://2024/1/15/10/30/a1b2c3d4.bin
              ↓ strip "store://"
relative:     2024/1/15/10/30/a1b2c3d4.bin
              ↓ prepend ALF_DATA_PATH/contentstore/
source:       {ALF_DATA_PATH}/contentstore/2024/1/15/10/30/a1b2c3d4.bin
```

### Destination (exports/)

```
full_path:    /Marketing/Reports/Q4/budget.xlsx
              ↓ split, drop last segment (filename)
folders:      ["Marketing", "Reports", "Q4"]
              ↓ safe-name each segment (replace unsafe chars with _)
dest:         {EXPORT_DIR}/{site_name}/files/Marketing/Reports/Q4/budget.xlsx
```

### Migration (exports/ → target-storage/)

```
local_export_path:  {EXPORT_DIR}/{site}/files/Marketing/Reports/Q4/budget.xlsx
                    ↓ generate UUID4
uuid_filename:      550e8400-e29b-41d4-a716-446655440000.xlsx
                    ↓ os.link() (hard link) or shutil.copy2() (cross-volume fallback)
target-storage:     {TARGET_STORAGE_PATH}/550e8400-e29b-41d4-a716-446655440000.xlsx
```

The `full_path` is also parsed to build the folder hierarchy in the target DB:

```
/Marketing/Reports/Q4/budget.xlsx
→ folder parts: ["Marketing", "Reports", "Q4"]
→ target folders: {site_name} → Marketing → Reports → Q4
→ leaf folder_id used for the files INSERT
```
