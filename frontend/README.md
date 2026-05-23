# Frontend — Alfresco Extract System

## Overview

Modern React + TypeScript + Vite frontend for the Alfresco Extract System. Provides a
professional file-explorer interface for browsing Alfresco sites, selecting folders for
extraction, and monitoring extraction jobs.

## Tech Stack

| Component     | Technology                      |
| ------------- | ------------------------------- |
| Framework     | React 18 + TypeScript           |
| Build Tool    | Vite 5                          |
| UI Library    | Mantine v7                      |
| Icons         | Lucide React                    |
| Data Fetching | TanStack Query (React Query v5) |
| Routing       | React Router v6                 |
| i18n          | react-i18next + i18next         |

## Environment Variables

Copy `../env/frontend.env.example` to `.env.local` in this directory and adjust as needed.

| Variable            | Description                             | Default                   |
| ------------------- | --------------------------------------- | ------------------------- |
| `VITE_API_BASE_URL` | API base URL (dev proxy handles `/api`) | (empty, uses Vite proxy)  |
| `VITE_APP_TITLE`    | App title shown in browser tab          | `Alfresco Extract System` |

In **development**, the Vite dev server proxies all `/api` requests to `http://localhost:8000`.
In **production**, nginx handles the proxy (configured in `nginx.conf`).

## Development Setup

### Prerequisites

- Node.js 20+
- Backend running on port 8000 (see backend README)

### Install

```bash
cd frontend
npm install
```

### Configure

```bash
cp ../env/frontend.env.example .env.local
# Edit .env.local if needed
```

### Run dev server

```bash
npm run dev
# UI available at http://localhost:5173
```

### Build for production

```bash
npm run build
# Output: dist/
```

## Features

### 🌐 Sites Page (`/sites`)

- Lists all Alfresco sites fetched from the backend
- Search/filter by site name or title
- **Browse** button → opens File Explorer for that site
- **Extract All** button → creates a job to extract all files from the site

### 🗂 File Explorer (`/sites/:siteName/explore`)

- Lazy-loading folder tree — expands on click, fetches children from API
- Checkbox selection on each folder
- Shows file count/size badges per folder (when available)
- **Select All / Deselect All** controls
- **Start Extraction** — creates job with only selected folder node IDs
- **Extract All** — creates job for entire site

### 📋 Jobs Page (`/jobs`)

- Table of all extraction jobs with status badges, progress bars, file counts
- Action buttons: Start Copy, Pause, Resume, Download CSV, View Files
- Auto-polls every 4 seconds while any job is active

### 📄 Job Detail (`/jobs/:jobId`)

- Summary stats: scanned, copied, failed, total files
- Scan and copy progress bars (animated during active phases)
- Paginated file records table (100 per page)
- Filter by file status (pending/copied/failed/skipped)
- Download metadata CSV

## i18n (Internationalization)

Supported languages: **English** (`en`) and **Japanese** (`ja`)

- Language is detected from browser preference or `localStorage`
- Persisted in `localStorage` under key `aes-language`
- Switch language via the dropdown in the header

To add a new language:

1. Create `src/i18n/locales/<lang>.json` (copy from `en.json`)
2. Add the language to `src/i18n/index.ts`
3. Add it to the header `Select` in `AppLayout.tsx`

## Theming

- Dark and light mode supported via Mantine's color scheme system
- Preference persisted in `localStorage` under key `aes-color-scheme`
- Toggle via the sun/moon button in the header
- Custom color palette: `brand` (blue)

## Project Structure

```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx           # Entry point — Mantine CSS, i18n init
    ├── App.tsx            # Root: MantineProvider, QueryClient, Router
    ├── theme.ts           # Mantine custom theme
    ├── utils.ts           # Formatting helpers (bytes, dates)
    ├── i18n/
    │   ├── index.ts       # i18next setup
    │   └── locales/
    │       ├── en.json    # English translations
    │       └── ja.json    # Japanese translations
    ├── api/
    │   └── client.ts      # All API types + fetch functions
    ├── hooks/
    │   ├── useSites.ts    # Sites query hook
    │   ├── useJobs.ts     # Job hooks (query, mutations, polling)
    │   └── useBrowse.ts   # Browse API hook
    ├── pages/
    │   ├── SitesPage.tsx
    │   ├── ExplorerPage.tsx
    │   ├── JobsPage.tsx
    │   └── JobDetailPage.tsx
    └── components/
        ├── AppLayout.tsx  # AppShell: header, navbar
        ├── FileTree.tsx   # Recursive lazy folder tree
        └── StatusBadge.tsx
```

## Docker

The frontend is built inside a multi-stage Docker container:

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS build
# ...npm run build...

# Stage 2: Serve
FROM nginx:alpine
# Serves dist/ + proxies /api to backend
```

```bash
docker compose up -d
# UI available at http://localhost:80
```
