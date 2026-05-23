from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import settings

# PostgreSQL engine for local job-tracking data
local_engine = create_engine(
    settings.local_db_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

LocalSession = sessionmaker(bind=local_engine, autocommit=False, autoflush=False)


class Base(DeclarativeBase):
    pass


def get_local_db():
    db = LocalSession()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """Create all local tracking tables in PostgreSQL and apply idempotent migrations."""
    from app.models import job  # noqa: F401 — registers models with Base
    from app.models import migration  # noqa: F401 — registers MigrationRecord with Base
    Base.metadata.create_all(bind=local_engine)
    # Idempotent column migrations for existing deployments
    with local_engine.connect() as conn:
        conn.execute(text(
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS selected_files TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS excluded_files TEXT"
        ))
        conn.execute(text(
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS total_size_bytes BIGINT DEFAULT 0"
        ))
        conn.execute(text(
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS copied_size_bytes BIGINT DEFAULT 0"
        ))
        conn.execute(text(
            "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS copy_started_at TIMESTAMP"
        ))
        conn.execute(text(
            "ALTER TABLE file_records ADD COLUMN IF NOT EXISTS transfer_speed_bps BIGINT"
        ))
        # Add new JobStatus enum values idempotently (PostgreSQL only)
        for val in ("migrating", "migrated"):
            conn.execute(text(
                f"ALTER TYPE jobstatus ADD VALUE IF NOT EXISTS '{val}'"
            ))
        conn.commit()
