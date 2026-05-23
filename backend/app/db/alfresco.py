from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.config import settings

# Read-only engine — never write to Alfresco's database
alfresco_engine = create_engine(
    settings.alfresco_db_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    connect_args={"options": "-c default_transaction_read_only=on"},
)

AlfrescoSession = sessionmaker(bind=alfresco_engine, autocommit=False, autoflush=False)


def get_alfresco_db():
    db = AlfrescoSession()
    try:
        yield db
    finally:
        db.close()
