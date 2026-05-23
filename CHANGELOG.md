# Changelog

All notable changes to the Alfresco Extract System are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/)

---

## [2.0.0] — Unreleased

### Added

#### Phase 3 — Migration to Target File-Manager System

- **`target_db` Docker service** (postgres:17-alpine, port `5434:5432`) simulating the target file-manager database; initialized by `docker/target_db_init.sql` with `folders` and `files` tables
- **`target-storage/`** bind-mounted directory for UUID-named physical files copied during migration
- **`MigrationRecord` ORM model** (`aes_tracking`) tracking per-file migration state: `pending | migrated | failed | skipped`
- **`migrate_site_task`** Celery task (Phase 3): walks exported files, creates folder hierarchy in target DB, inserts file rows, copies files as `{uuid}.{ext}`, fully idempotent and pause-resumable
- **`migration_service.py`** — `ensure_folder_path`, `migrate_file_record`, `generate_migration_sql`
- **Migration API** (`routers/migration.py`): `POST /migrate`, `GET /migration`, `GET /migration/sql`, `POST /migration/pause`, `POST /migration/resume`
- **Migration tab** on Job Detail page: progress stats cards, records table (UUID filename, status, target folder/file IDs), Start/Pause/Resume controls, Download SQL button
- `migrating` and `migrated` added to `JobStatus` enum with corresponding status badges (indigo/teal)
- `MigrationStatusBadge` component in `StatusBadge.tsx`
- Migration i18n keys for English and Japanese (`migration.*`, `migrationStatus.*`)
- `TARGET_DB_URL` and `TARGET_STORAGE_PATH` environment variables

#### Infrastructure

- Exposed `local_db` on host port `5433:5432` (user: aes_user / aes_pass / db: aes_tracking)
- Exposed `target_db` on host port `5434:5432` (user: target_user / target_pass / db: target_files)

#### Bug Fixes

- **Elapsed time UTC fix**: `JobOut` and `FileRecordOut` Pydantic schemas now serialize all `datetime` fields with a `Z` suffix, preventing browsers in non-UTC timezones from misinterpreting naive UTC timestamps (previously showed +9 h in JST)

- React 18 + TypeScript + Vite 5 frontend replacing the old vanilla JS interface
- Mantine v7 UI framework with custom `brand` blue color palette
- Lucide React icons throughout
- **i18n support** — English (`en`) and Japanese (`ja`), auto-detected from browser, persisted in `localStorage`
- **Dark / Light theme** toggle, persisted in `localStorage`
- **Sites Page** — grid of site cards with search/filter, Browse and Extract All actions
- **File Explorer Page** — lazy-loading recursive folder tree with checkbox selection; supports selective folder extraction or extract-all
- **Jobs Page** — table with status badges, dual progress bars (scan + copy), action buttons (Start Copy, Pause, Resume, Download CSV)
- **Job Detail Page** — stats cards, animated progress bars, paginated file records table with status filter
- React Router v6 with SPA fallback routing
- TanStack Query (React Query v5) with automatic polling during active jobs (3–4 s)
- `@mantine/notifications` for toast feedback on all mutations
- Dockerfile (multi-stage: Node 20 build → nginx:alpine serve)
- nginx reverse proxy config (`nginx.conf`) proxying `/api/` to the backend service with SPA fallback

#### Backend

- **Browse API** — `GET /api/sites/{name}/browse?parent_id=<int>` for lazy folder/file tree navigation
- **Selective folder extraction** — `Job.selected_folders` (JSON) stores selected Alfresco node IDs; extractor targets only those subtrees
- `FolderNodeOut`, `FileNodeBrief`, `BrowseResult` Pydantic schemas
- `FileRecordPage` paginated response schema for `/api/jobs/{id}/files` (now includes `total` count)
- Bulk-optimized browse queries using IN clauses (no N+1 queries)
- Swagger UI at `/api/docs` and ReDoc at `/api/redoc` with rich OpenAPI metadata
- `get_site_node_and_doclib()`, `get_parent_node_id()`, `get_folder_children()` in `alfresco_db.py`

#### Infrastructure

- Local tracking database migrated from **SQLite** to **PostgreSQL 17** (`aes_tracking` database)
- `local_db` PostgreSQL service in `docker-compose.yml`
- `frontend` nginx service in `docker-compose.yml`
- `env/` folder for environment configuration templates:
  - `env/backend.env.example` — all backend environment variables
  - `env/frontend.env.example` — all frontend Vite variables (`VITE_` prefixed)

#### Documentation

- `backend/README.md` — setup, env vars, API endpoint reference, dev and Docker instructions
- `frontend/README.md` — setup, env vars, features, i18n guide, project structure
- `CHANGELOG.md` — this file
- Updated root `README.md` to reflect new architecture and structure

### Changed

- `backend/app/config.py` — `local_db_url` default changed to PostgreSQL; reads from `../env/backend.env`
- `backend/app/db/local.py` — removed SQLite `connect_args`; added PostgreSQL pool settings
- `backend/app/models/job.py` — added `selected_folders` (`Text`) column
- `backend/app/models/schemas.py` — updated `JobCreate`, `JobOut`; added browse and paginated schemas
- `backend/app/services/extractor.py` — targeted scan when `selected_folder_ids` present
- `backend/app/routers/files.py` — `/files` now returns `{total, files}` paginated response
- `backend/app/main.py` — browse router registered; Vite `dist/` served as static; SPA catch-all route
- `docker-compose.yml` — added `local_db` + `frontend` services; backend uses `env_file`
- `frontend/index.html` — replaced with minimal React entry point

### Removed

- Old vanilla JS `frontend/app.js` and `frontend/style.css` (superseded by React build)
- SQLite local tracking database (`job_tracking.db`)

---

## [2.1.0] — Unreleased

### Added

#### Frontend

- **File search** — search bar in the Site Explorer page; queries Alfresco DB directly (ILIKE via recursive CTE), results appear in an OneDrive-like list with MIME icon, modifier, date, and size; minimum 2 characters to trigger
- **Job deletion** — Trash icon button per job row with a confirmation modal; deletes job and all associated file records
- **OneDrive-like metadata columns** in the file tree: Name | Modified By | Date Modified | Size with column headers
- **Single-click folder expand** — folders now expand on first click with a loading spinner in the chevron; previously required two clicks due to stale closure bug
- `SearchResultList` component — reusable flat search results list with skeleton loading state
- Additional MIME type icons: `Sheet` (spreadsheets), `Presentation` (PowerPoint), `Archive` (zip)
- i18n keys for search, job deletion, and column headers (EN + JA)

#### Backend

- `DELETE /api/jobs/{id}` — deletes job and all file records (manual cascade; no FK violation)
- `GET /api/sites/{name}/search?q=<term>&limit=50` — searches files in a site's documentLibrary using a PostgreSQL recursive CTE on `alf_child_assoc`
- `search_files(db, doclib_node_id, query, limit)` in `alfresco_db.py`

### Fixed

- `FileTree.tsx` stale closure bug causing double-click requirement: `onUpdate` now uses functional `setNodes((prev) => ...)` at root level, eliminating stale captures in child node closures
- Duplicate function bodies removed from `FileTree.tsx` and `ExplorerPage.tsx` (leftover from previous edit)
- `search_files` function in `alfresco_db.py` was missing its `def` declaration (docstring and body existed without signature) — now restored

---

## [2.3.0] — Unreleased

### Added

- **`COPY_CONCURRENCY` environment variable** (default `8`) — controls the number of files copied concurrently during Phase 2. Configurable via `env/backend.env`.
- **Pagination on Migration tab** — `GET /api/jobs/{id}/migration` now accepts `page` and `limit` query params (default 100, max 500); response includes `total_records` for frontend pagination. Migration records table renders a `<Pagination>` component when total exceeds one page.
- **Revert migration endpoint** — `DELETE /api/jobs/{id}/migration` documented in endpoint table.
- **Original filename + path columns** in migration records table — backend JOIN on `FileRecord` populates `original_name` and `original_path` in `MigrationRecordOut`.

### Changed

- **Phase 2 file copy is now concurrent** — `file_copier.py` refactored from a sequential `for` loop to `ThreadPoolExecutor` with batch-of-N concurrency (N = `COPY_CONCURRENCY`). Pause signal is checked between batches; DB commits remain serialized on the main thread for safety.
- **File Records sort order** — `GET /api/jobs/{id}/files` now returns records sorted by status priority (`copied → failed → pending → skipped`) then newest ID first, so live copy progress is visible at the top without scrolling.
- **Migration records sort order** — migrated records appear first, then failed, then pending; `migrated_at DESC NULLS LAST` as secondary sort within each group.
- **`MigrationProgressOut` schema** — added `total_records: int` field (total count across all pages, used for frontend pagination).
- **`useMigration` React hook** — accepts `page` and `limit` parameters; both are included in the React Query cache key so page changes trigger a fresh fetch.

---

## [2.2.0] — Unreleased

### Added

#### Backend

- **Alfresco shortcut resolution** — `app:filelink` and `app:folderlink` nodes are now transparently handled during site extraction and file browsing:
  - `resolve_shortcut_target(db, node_id)` — resolves a shortcut's linked target via `alf_node_assoc (app:linkedNode)`
  - `_detect_shortcut_types(db, node_ids)` — batch-detects shortcut type for a list of nodes
  - `_find_shortcuts_in_tree(db, root_id)` — scans a cm:contains subtree for all filelink/folderlink nodes
  - `_resolve_filelink_nodes(db, shortcut_node_ids)` — fetches content URL/size from target nodes while preserving the shortcut's own node_id/uuid for path resolution
  - `get_all_file_nodes` updated — now recurses `app:folderlink` targets and includes `app:filelink` content; cycle guard via `_visited` set prevents infinite loops on circular shortcuts
  - `get_folder_children` updated — folder shortcuts redirect to target's children; file shortcuts appear as regular files with resolved content metadata; `is_shortcut` flag added to all folder/file entries
  - Path resolution for shortcuts: `extractor.py` uses `shortcut_path_prefix` + `shortcut_path_root_id` from node dict so exported path reflects the shortcut's location in the site tree, not the target's original location
  - `get_file_nodes_by_ids` updated — returns `shortcut_path_prefix`/`shortcut_path_root_id` fields for API consistency

---

## [1.0.0] — Initial Release

- FastAPI backend with Celery + Redis background jobs
- SQLite local job tracking database
- Vanilla JS single-page frontend
- Direct Alfresco PostgreSQL querying (read-only)
- File copy from `contentstore/` to `exports/` with restored folder hierarchy
- Metadata CSV export per site
- Job lifecycle: created → scanning → scanned → copying → done
- Pause/resume support for long-running extractions
