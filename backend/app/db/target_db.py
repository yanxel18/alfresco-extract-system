from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import settings

target_engine = create_engine(
    settings.target_db_url,
    pool_pre_ping=True,
    pool_size=3,
    max_overflow=5,
)

TargetSession = sessionmaker(bind=target_engine, autocommit=False, autoflush=False)


def get_target_db():
    db = TargetSession()
    try:
        yield db
    finally:
        db.close()
