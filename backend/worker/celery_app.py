from celery import Celery
from app.config import settings

celery_app = Celery(
    "alfresco_extract",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["worker.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    result_expires=86400 * 7,
    # Windows requires threads pool — prefork does not work correctly on Windows.
    # "solo" would also work but is single-threaded and ignores --concurrency.
    worker_pool="threads",
)
