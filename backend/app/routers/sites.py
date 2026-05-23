from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.alfresco import get_alfresco_db
from app.models.schemas import SiteOut
from app.services import alfresco_db as adb

router = APIRouter(prefix="/api/sites", tags=["sites"])


@router.get("", response_model=list[SiteOut])
def get_sites(db: Session = Depends(get_alfresco_db)):
    """List all Alfresco sites available for extraction."""
    sites = adb.list_sites(db)
    return [
        SiteOut(
            short_name=s["short_name"],
            title=s["title"],
            description=s["description"],
            node_ref=f"workspace://SpacesStore/{s['uuid']}",
        )
        for s in sites
    ]
