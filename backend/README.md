# Backend — Alfresco Extract System

## Overview

FastAPI + Celery backend that extracts files and metadata from Alfresco Community Edition
by directly querying the Alfresco PostgreSQL database and reading from the `contentstore/`.

## Tech Stack

| Component       | Technology             |
| --------------- | ---------------------- |
| API Server      | FastAPI + Uvicorn      |
| Background Jobs | Celery 5 + Redis 7     |
| Job Tracking DB | PostgreSQL 17 (local)  |
| Alfresco DB     | PostgreSQL (read-only) |
| Config          | Pydantic Settings      |

## API Documentation

When the server is running:

- **Swagger UI**: http://localhost:8000/api/docs
- **ReDoc**: http://localhost:8000/api/redoc
- **OpenAPI JSON**: http://localhost:8000/api/openapi.json

## Environment Variables

Copy `../env/backend.env.example` to `../env/backend.env` and fill in values.

| Variable              | Description                                        | Default                                                       |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| `ALFRESCO_DB_URL`     | Alfresco PostgreSQL connection string (read-only)  | `postgresql://alfresco:alfresco@localhost/alfresco`           |
| `LOCAL_DB_URL`        | Local tracking PostgreSQL connection string        | `postgresql://aes_user:aes_pass@localhost/aes_tracking`       |
| `ALF_DATA_PATH`       | Path to Alfresco `alf_data` directory on the host  | (required)                                                    |
| `REDIS_URL`           | Redis connection for Celery                        | `redis://localhost:6379/0`                                    |
| `EXPORT_DIR`          | Output directory for extracted files and CSV       | `./exports`                                                   |
| `TARGET_DB_URL`       | Target file-manager PostgreSQL (Phase 3 migration) | `postgresql://target_user:target_pass@target_db/target_files` |
| `TARGET_STORAGE_PATH` | Flat storage directory for UUID-named files        | `./target-storage`                                            |
| `ALFRESCO_API_URL`    | Alfresco REST API URL (optional fallback)          | `http://localhost:8080/alfresco`                              |
| `ALFRESCO_USER`       | Alfresco admin username                            | `admin`                                                       |
| `ALFRESCO_PASS`       | Alfresco admin password                            | `admin`                                                       |

## API Endpoints

### Health

| Method | Path          | Description             |
| ------ | ------------- | ----------------------- |
| GET    | `/api/health` | API + Redis + DB health |

### Sites

| Method | Path                       | Description                    |
| ------ | -------------------------- | ------------------------------ |
| GET    | `/api/sites`               | List all Alfresco sites        |
| GET    | `/api/sites/{name}/browse` | Browse folders/files in a site |
| GET    | `/api/sites/{name}/search` | Search files by name in a site |

**Browse query params**: `parent_id` (integer, optional — omit for doclib root)

**Search query params**: `q` (search term, min 2 chars), `limit` (default 50)

### Jobs

| Method | Path                        | Description                |
| ------ | --------------------------- | -------------------------- |
| GET    | `/api/jobs`                 | List all jobs              |
| POST   | `/api/jobs`                 | Create extraction job      |
| GET    | `/api/jobs/{id}`            | Get job details            |
| DELETE | `/api/jobs/{id}`            | Delete job and all records |
| POST   | `/api/jobs/{id}/start-copy` | Trigger file copy phase    |
| POST   | `/api/jobs/{id}/pause`      | Pause active job           |
| POST   | `/api/jobs/{id}/resume`     | Resume paused/failed job   |

**Create job body**:

```json
{
  "site_name": "my-site",
  "selected_folder_node_ids": [12345, 67890]
}
```

Pass an empty array `[]` to extract the entire site.

### Files

| Method | Path                   | Description                   |
| ------ | ---------------------- | ----------------------------- |
| GET    | `/api/jobs/{id}/files` | List file records (paginated) |
| GET    | `/api/jobs/{id}/csv`   | Download metadata CSV         |

**Files query params**: `status` (pending/copied/failed/skipped), `limit` (max 1000), `offset`

### Migration (Phase 3)

| Method | Path                              | Description                                       |
| ------ | --------------------------------- | ------------------------------------------------- |
| POST   | `/api/jobs/{id}/migrate`          | Start migration into target file-manager DB       |
| GET    | `/api/jobs/{id}/migration`        | Get migration progress and per-file records       |
| GET    | `/api/jobs/{id}/migration/sql`    | Download SQL INSERT script (for manual execution) |
| POST   | `/api/jobs/{id}/migration/pause`  | Pause active migration                            |
| POST   | `/api/jobs/{id}/migration/resume` | Resume paused/failed migration                    |

Migration can only be started when the job status is `done` or `migrated` (re-run). The task is idempotent — already-migrated files are skipped on re-run.

## Development Setup

### Prerequisites

- Python 3.12+
- Redis 7 (or `docker run -d -p 6379:6379 redis:7-alpine`)
- PostgreSQL 17 for local tracking DB

### Install

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
```

### Configure

```bash
cp ../env/backend.env.example ../env/backend.env
# Edit ../env/backend.env with your values
```

### Run

```bash
# API server (hot reload)
uvicorn app.main:app --reload --port 8000

# Celery worker (separate terminal)
celery -A worker.celery_app worker --loglevel=info --concurrency=2
```

## Docker

```bash
# From project root
docker compose up -d
```

The backend service starts on port 8000 internally (exposed via nginx frontend on port 80).

## Project Structure

```
backend/
├── app/
│   ├── config.py          # Pydantic settings
│   ├── main.py            # FastAPI app + router registration + Swagger
│   ├── db/
│   │   └── local.py       # Local PostgreSQL engine + session
│   ├── models/
│   │   ├── job.py         # SQLAlchemy ORM models
│   │   └── schemas.py     # Pydantic request/response schemas
│   ├── routers/
│   │   ├── sites.py       # Sites endpoints
│   │   ├── browse.py      # Browse API
│   │   ├── jobs.py        # Job lifecycle endpoints
│   │   └── files.py       # File records + CSV download
│   └── services/
│       ├── alfresco_db.py # All Alfresco PG queries (read-only)
│       └── extractor.py   # Scan + copy logic
└── worker/
    ├── celery_app.py      # Celery configuration
    └── tasks.py           # extract_site_task, copy_site_task
```

## Coding Conventions

- All Alfresco PG queries in `services/alfresco_db.py` — never inline SQL elsewhere
- Raw SQL via `text()` for Alfresco PG — no ORM mapping to `alf_*` tables
- SQLAlchemy ORM for local PostgreSQL models (Job, FileRecord)
- Celery tasks must be **idempotent** — safe to re-run on same job_id
- All file paths via `pathlib.Path` — never string concatenation
