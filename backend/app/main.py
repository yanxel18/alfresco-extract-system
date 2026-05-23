import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text

from app.db.local import init_db
from app.config import settings
from app.routers import sites, jobs, files, browse, migration

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing local PostgreSQL tracking database…")
    init_db()
    settings.export_dir.mkdir(parents=True, exist_ok=True)
    settings.target_storage_path.mkdir(parents=True, exist_ok=True)
    logger.info("Export directory: %s", settings.export_dir.resolve())
    logger.info("Target storage: %s", settings.target_storage_path.resolve())
    yield


app = FastAPI(
    title="Alfresco Extract System",
    description="""
## Alfresco Extract System API

Bulk extract files and metadata from **Alfresco Community Edition** by querying the
Alfresco PostgreSQL database directly and reading the physical content store.

### Workflow

1. **Browse** — Use `GET /api/sites/{site}/browse` to navigate the folder tree and pick
   which folders to include.
2. **Create Job** — `POST /api/jobs` with optional `selected_folder_node_ids` to scope
   the extraction to specific folders, or omit to extract everything.
3. **Monitor** — Poll `GET /api/jobs/{id}` until `status` reaches `scanned`.
4. **Start Copy** — `POST /api/jobs/{id}/start-copy` to copy physical files to `exports/`.
5. **Download** — `GET /api/jobs/{id}/csv` to get the metadata CSV.

### Notes

- All Alfresco DB queries are **read-only**.
- Jobs are **resumable** — re-run `start-copy` on a failed job to continue from where
  it stopped.
""",
    version="2.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    contact={"name": "Alfresco Extract System"},
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sites.router)
app.include_router(browse.router)
app.include_router(jobs.router)
app.include_router(files.router)
app.include_router(migration.router)


@app.get("/api/health", tags=["health"], summary="System health check",
         description="Check connectivity to Redis and the Alfresco PostgreSQL database.")
def health_check():
    import redis as redis_lib

    result = {"api": "ok", "redis": "error", "alfresco_db": "error"}

    try:
        r = redis_lib.from_url(settings.redis_url, socket_connect_timeout=2)
        r.ping()
        result["redis"] = "ok"
    except Exception as e:
        result["redis"] = str(e)

    try:
        from app.db.alfresco import alfresco_engine
        with alfresco_engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        result["alfresco_db"] = "ok"
    except Exception as e:
        result["alfresco_db"] = str(e)

    return result


# ---------------------------------------------------------------------------
# Serve React frontend (Vite dist/) — SPA fallback routing
# ---------------------------------------------------------------------------
_root = Path(__file__).parent.parent.parent
_dist_dir = _root / "frontend" / "dist"
_legacy_frontend = _root / "frontend"

if _dist_dir.exists():
    # Production: serve Vite build output
    _assets = _dist_dir / "assets"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str, request: Request):
        static_file = _dist_dir / full_path
        if static_file.is_file():
            return FileResponse(str(static_file))
        return FileResponse(str(_dist_dir / "index.html"))

elif _legacy_frontend.exists():
    # Dev fallback: serve legacy vanilla frontend when dist/ not built yet
    app.mount("/static", StaticFiles(directory=str(_legacy_frontend)), name="static")

    @app.get("/", include_in_schema=False)
    def serve_legacy():
        return FileResponse(str(_legacy_frontend / "index.html"))
