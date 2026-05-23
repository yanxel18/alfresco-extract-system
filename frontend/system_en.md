# Alfresco Extract System — Frontend Technical Reference

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Application Structure](#3-application-structure)
4. [Routing & Pages](#4-routing--pages)
5. [API Client](#5-api-client)
6. [Data Fetching & Polling](#6-data-fetching--polling)
7. [State Management](#7-state-management)
8. [Key Pages — Detailed Behaviour](#8-key-pages--detailed-behaviour)
9. [Internationalisation (i18n)](#9-internationalisation-i18n)
10. [Migration Flow from the UI Perspective](#10-migration-flow-from-the-ui-perspective)
11. [Progress Bar Logic](#11-progress-bar-logic)
12. [Duplicate Handling in the UI](#12-duplicate-handling-in-the-ui)
13. [Theme & Design System](#13-theme--design-system)
14. [Build & Development](#14-build--development)

---

## 1. Overview

The frontend is a **single-page React application** that provides:

- A **Sites** browser to list and explore all Alfresco sites.
- A **File Explorer** for browsing folder/file trees within a site before creating a job.
- A **Jobs** dashboard listing all extraction jobs with their live status.
- A **Job Detail** view with three tabs (Files, Copy, Migration) showing per-file progress and allowing job control (start, pause, resume, delete) and migration control (start, pause, resume, revert).

All API communication is through a single typed client (`api/client.ts`). There is no Redux or Zustand — state lives in React Query's cache, refreshed by polling.

---

## 2. Tech Stack

| Library                      | Version | Purpose                                                     |
| ---------------------------- | ------- | ----------------------------------------------------------- |
| React                        | 18      | UI framework                                                |
| TypeScript                   | 5       | Type safety                                                 |
| Vite                         | 5       | Build tool & dev server                                     |
| Mantine                      | v7      | UI component library (Modal, Table, Badge, Progress, Tabs…) |
| Lucide React                 | —       | Icon set                                                    |
| TanStack Query (React Query) | v5      | Server state, caching, polling                              |
| React Router DOM             | v6      | Client-side routing                                         |
| react-i18next                | —       | Internationalisation (English + Japanese)                   |

---

## 3. Application Structure

```
frontend/src/
├── api/
│   └── client.ts          — All API types + fetch functions (single source of truth)
├── components/
│   └── AppLayout.tsx      — Shell: top nav, language switcher, colour scheme toggle
├── hooks/
│   ├── useJobs.ts         — React Query hooks for jobs + files + migration
│   ├── useSites.ts        — Sites list query hook
│   └── useBrowse.ts       — Folder/file tree browse query hook
├── i18n/
│   ├── i18n.ts            — i18next initialisation (language detection, namespace)
│   └── locales/
│       ├── en.json        — English translation strings
│       └── ja.json        — Japanese translation strings
├── pages/
│   ├── SitesPage.tsx      — List of Alfresco sites with "Explore" / "Create Job" buttons
│   ├── ExplorerPage.tsx   — File explorer for scoping job selection
│   ├── JobsPage.tsx       — All jobs table with status badges
│   └── JobDetailPage.tsx  — Job detail: Files tab, Copy tab, Migration tab
├── App.tsx                — QueryClient setup, router definition, Mantine theme provider
├── main.tsx               — React DOM entry point
├── theme.ts               — Custom Mantine theme overrides
└── utils.ts               — Shared helpers (formatBytes, formatSpeed, etc.)
```

---

## 4. Routing & Pages

Routes are defined in `App.tsx` via `createBrowserRouter`:

| URL                        | Component       | Purpose                              |
| -------------------------- | --------------- | ------------------------------------ |
| `/`                        | —               | Redirects to `/sites`                |
| `/sites`                   | `SitesPage`     | Lists all Alfresco sites             |
| `/sites/:siteName/explore` | `ExplorerPage`  | Browse folders/files and create jobs |
| `/jobs`                    | `JobsPage`      | All jobs dashboard                   |
| `/jobs/:jobId`             | `JobDetailPage` | Detailed job view                    |

All routes share the `AppLayout` wrapper (top nav, language switcher).

---

## 5. API Client

**File:** `src/api/client.ts`

This is the **only** file that defines API types and fetch calls. Never define API types inline in components.

### Type Definitions

```typescript
// Core job/file status enums
type JobStatus = "created"|"scanning"|"scanned"|"copying"|"done"|"paused"|"failed"|"migrating"|"migrated";
type FileStatus = "pending"|"copied"|"failed"|"skipped";
type MigrationStatus = "pending"|"migrated"|"failed"|"skipped";

// Main data shapes
interface Job { id, site_name, status, total_files, scanned_files, copied_files, ... }
interface FileRecord { id, node_ref, full_path, file_name, status, local_export_path, ... }
interface MigrationRecord { id, job_id, file_record_id, status, uuid_filename, duration_ms, ... }
interface MigrationProgress { status, total, migrated, failed, pending, skipped, records[] }
interface BrowseResult { site_name, folders[], files[], current_node_id, parent_node_id? }
```

### API Namespaces

```typescript
api.health.get()                           // GET /api/health
api.sites.list()                           // GET /api/sites
api.browse.get(siteName, parentId?)        // GET /api/sites/{name}/browse[?parent_id=...]
api.browse.search(siteName, q, limit)      // GET /api/sites/{name}/search?q=...
api.browse.folderSize(siteName, nodeIds)   // GET /api/sites/{name}/folder-size?node_ids=...
api.jobs.list()                            // GET /api/jobs
api.jobs.get(id)                           // GET /api/jobs/{id}
api.jobs.create(payload)                   // POST /api/jobs
api.jobs.startCopy(id)                     // POST /api/jobs/{id}/start-copy
api.jobs.pause(id)                         // POST /api/jobs/{id}/pause
api.jobs.resume(id)                        // POST /api/jobs/{id}/resume
api.jobs.delete(id)                        // DELETE /api/jobs/{id}
api.files.list(jobId, {status, limit, offset})  // GET /api/jobs/{id}/files
api.files.csvUrl(jobId)                    // /api/jobs/{id}/csv (direct URL for download link)
api.migration.start(id)                    // POST /api/jobs/{id}/migrate
api.migration.get(id, page, limit)         // GET /api/jobs/{id}/migration
api.migration.pause(id)                    // POST /api/jobs/{id}/migration/pause
api.migration.resume(id)                   // POST /api/jobs/{id}/migration/resume
api.migration.revert(id)                   // DELETE /api/jobs/{id}/migration
api.migration.sqlUrl(id)                   // /api/jobs/{id}/migration/sql (download link)
```

### Error Handling

All calls go through a shared `request<T>()` helper that throws `Error("API {status}: {body}")` on non-OK responses. Components should wrap calls in try/catch or use React Query's `error` state.

### URL Routing (Dev vs Production)

- **Dev**: Vite config proxies `/api/*` → `http://localhost:8000/api/*`.
- **Production**: nginx serves the Vite `dist/` and proxies `/api/` → `backend:8000`.

No absolute URLs — all calls use `/api/...` (relative path).

---

## 6. Data Fetching & Polling

All server state uses **TanStack React Query v5**. No `useEffect` with `setInterval` — polling is managed declaratively via `refetchInterval`.

### Global Query Client (App.tsx)

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000, // 10 seconds before a cached result is considered stale
    },
  },
});
```

### Polling Intervals by Hook

| Hook             | Interval  | Condition                                                 |
| ---------------- | --------- | --------------------------------------------------------- |
| `useJobs()`      | 4 seconds | Always on the Jobs page                                   |
| `useJob(id)`     | 3 seconds | Only when status is `scanning`, `copying`, or `migrating` |
| `useJobFiles()`  | 2 seconds | Only when status is `copying` or `scanning`               |
| `useMigration()` | 3 seconds | Only when migration response's `status === "migrating"`   |

Polling stops automatically when the job reaches a terminal state (`done`, `migrated`, `failed`, `paused`).

### Cache Invalidation

After mutations (start, pause, resume, delete), React Query's `invalidateQueries()` is called to force a fresh fetch of affected queries. This ensures the UI immediately reflects the new state.

---

## 7. State Management

There is **no global state store** (no Redux, no Zustand, no Context for business data). All server state is managed by React Query. Local UI state (modals open, selected folders, current page) uses `useState`.

**Key hook summary:**

```typescript
// Jobs list page
const { data: jobs } = useJobs(); // polls every 4s

// Job detail page
const { data: job } = useJob(id); // polls 3s when active
const { data: files } = useJobFiles(id, page, limit, status, job.status);
const { data: migration } = useMigration(id, job.status);

// Mutations
const { startCopy, pause, resume } = useJobAction(id);
const { start, pause, resume, revert } = useMigrationActions(id);
```

---

## 8. Key Pages — Detailed Behaviour

### 8.1 SitesPage

- Fetches `api.sites.list()` on mount.
- Displays a card grid of all Alfresco sites.
- **"Explore"** → navigates to `/sites/:siteName/explore`.
- **"Create Job"** → opens a confirmation modal, calls `api.jobs.create({ site_name })` (full site migration — no folder selection).

### 8.2 ExplorerPage

- Displays a two-pane file browser: folder tree (left) + file list (right).
- Folder navigation: clicking a folder calls `api.browse.get(siteName, nodeId)`. Breadcrumbs track the current path.
- Folder/file selection: checkboxes allow selecting specific folders and files. The job will only scan the selected scope.
- **Folder size hint**: selected folders' sizes are fetched via `api.browse.folderSize()`.
- **Create Job button**: calls `api.jobs.create({ site_name, selected_folder_node_ids, selected_file_node_ids })`.
- **File search**: search bar calls `api.browse.search()` for quick file lookup within a site.

### 8.3 JobsPage

- Fetches `useJobs()` — polls every 4 seconds.
- Table shows: Site, Status badge, Total files, Copied, Failed, Created time.
- Clicking any row navigates to `/jobs/:jobId`.
- Delete button with confirmation modal calls `api.jobs.delete(id)`.

### 8.4 JobDetailPage

This is the most complex page. It has three tabs:

**Tab 1 — Files** (`scanning` / `scanned` phase):

- Shows all `FileRecord` rows with pagination (100 per page).
- Status filter dropdown (all / pending / copied / failed / skipped).
- Columns: File Name, Path, Size, Status, Speed, Error.
- Polls every 2s while `scanning` or `copying`.
- CSV export download link (`api.files.csvUrl(id)`).

**Tab 2 — Copy** (`copying` / `done` phase):

- Overall copy progress bar: `copied_size_bytes / total_size_bytes`.
- Per-file status counts as badge row.
- "Start Copy" button (from `scanned` status).
- "Pause" / "Resume" controls.
- File table same as Tab 1.

**Tab 3 — Migration** (`done` / `migrating` / `migrated` phase):

- Enabled only when `job.status` is `done`, `migrating`, `migrated`, `paused`, or `failed`.
- "Start Migration" button (from `done`).
- Pause / Resume / Revert controls.
- Progress bar: `(migrated + skipped) / total * 100` — skipped files count as done.
- Tab badge shows `migrated + skipped / total`.
- `MigrationRecord` table with columns: File, Original Path, Status, UUID Filename, Duration, Error.
- SQL export download link (`api.migration.sqlUrl(id)`).

---

## 9. Internationalisation (i18n)

**Library:** `react-i18next`

**Supported languages:** English (`en`) and Japanese (`ja`).

**Language detection order:**

1. `localStorage` key `i18nextLng`.
2. Browser navigator language.
3. Fallback: `en`.

**Translation files:**

- `src/i18n/locales/en.json`
- `src/i18n/locales/ja.json`

**Key structure:**

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

**Usage in components:**

```typescript
const { t } = useTranslation();
// t("migrationStatus.migrated") → "Migrated" / "マイグレーション完了"
// t("jobStatus.copying") → "Copying…" / "コピー中…"
```

**Language switcher:** In `AppLayout.tsx`, toggles between `en` / `ja` and persists to `localStorage`.

**Rule:** No hardcoded UI strings in components. All user-visible text must be in the locale JSON files.

---

## 10. Migration Flow from the UI Perspective

The migration flow is controlled entirely from the **Migration tab** on `JobDetailPage`:

```
Job status = done
  ↓ User clicks "Start Migration"
  ↓ api.migration.start(id) → POST /api/jobs/{id}/migrate
  ↓ Backend dispatches migrate_site_task to Celery

Job status = migrating
  ↓ useMigration() polls every 3 seconds
  ↓ MigrationProgress.records[] updates with per-file status

Job status = migrated / failed / paused
  ↓ Polling stops
  ↓ Final state shown in table

User clicks "Pause"
  → api.migration.pause(id) → backend sets status=paused, revokes Celery task
  → refetchInterval returns false → polling stops

User clicks "Resume"
  → api.migration.resume(id) → backend dispatches new migrate_site_task
  → refetchInterval returns 3000 (based on response status=migrating)

User clicks "Revert"
  → Confirmation modal
  → api.migration.revert(id) → DELETE /api/jobs/{id}/migration
  → All migrated files removed from target DB and target-storage/
  → Job returns to status=done
```

### Skipped (Duplicate) Files in the UI

When a file is already present in the target system (same `source_node_ref`), the backend marks its `MigrationRecord` with:

- `status: "skipped"`
- `error_msg: "Already migrated from another job"`

The UI displays these rows with a yellow/orange "Skipped (duplicate)" badge. They are counted as "done" for progress bar purposes.

---

## 11. Progress Bar Logic

### Copy Phase Progress

```typescript
// Total bytes progress (shows actual data transferred)
const copyProgress =
  job.total_size_bytes > 0
    ? (job.copied_size_bytes / job.total_size_bytes) * 100
    : 0;
```

### Migration Phase Progress

```typescript
// (migrated + skipped) counts as done — skipped = duplicate = already in target
const migrationProgress =
  migration.total > 0
    ? ((migration.migrated + migration.skipped) / migration.total) * 100
    : 0;

// Tab badge (e.g. "8/10")
const migrationTabBadge = `${migration.migrated + migration.skipped}/${migration.total}`;
```

**Why skipped counts as done:** A "skipped" file means it already exists in the target system from a previous job. From a migration-completeness perspective, it is effectively migrated — the target system has the file. Counting only `migrated` would leave the progress bar stuck below 100% if duplicates exist.

---

## 12. Duplicate Handling in the UI

When two jobs cover the same files (e.g. two jobs for the same site, or overlapping folder selections):

1. The second job's migration task finds the files already in the target DB (`source_node_ref` match).
2. Those files are marked `skipped` in `MigrationRecord`.
3. The UI Migration tab shows:
   - A dedicated **Skipped** count in the status summary row.
   - Each `skipped` record in the table with a "Skipped (duplicate)" badge.
   - Progress bar advances normally (skipped = done).
4. The original file in the target system is **not affected** — no double-insert.

This is purely informational in the UI — no user action required.

---

## 13. Theme & Design System

- **Mantine v7** provides the component library (modals, badges, tables, tabs, progress bars, notifications).
- **Custom theme** in `theme.ts` defines primary colour, font, radius, and spacing overrides.
- **Colour scheme**: Light / dark mode toggle, persisted to `localStorage` via `localStorageColorSchemeManager`.
  - Storage key: `aes-color-scheme`.
- **Lucide React** provides all icons (consistent stroke-style icon set).

---

## 14. Build & Development

### Development

```bash
cd frontend
npm install
npm run dev     # Vite dev server at http://localhost:5173 with /api proxy
```

**Vite proxy config** (`vite.config.ts`):

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:8000',
  }
}
```

### Production Build

```bash
npm run build   # TypeScript compile + Vite bundle → dist/
```

Output: `dist/` directory served by nginx in production.

### Docker

The frontend has a multi-stage `Dockerfile`:

1. **builder** stage: `node:20-alpine` → `npm ci` → `npm run build`.
2. **production** stage: `nginx:alpine` → copies `dist/` into nginx web root.

The nginx config also proxies `/api/` to `backend:8000`.

### Environment Variables

Frontend environment variables use Vite's `VITE_` prefix and are baked into the bundle at build time:

| Variable        | Purpose                                                      |
| --------------- | ------------------------------------------------------------ |
| `VITE_API_BASE` | Override the `/api` base path (optional; defaults to `/api`) |

All other configuration (backend URLs, DB credentials) stays in the backend `.env`. The frontend only needs to know the API base path.
