from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    alfresco_db_url: str
    alf_data_path: Path
    local_db_url: str = "postgresql://aes_user:aes_pass@localhost:5432/aes_tracking"
    redis_url: str = "redis://localhost:6379/0"
    export_dir: Path = Path("./exports")
    alfresco_api_url: str = "http://localhost:8080/alfresco"
    alfresco_user: str = "admin"
    alfresco_pass: str = "admin"
    # Target system (simulated migration destination)
    target_db_url: str = "postgresql://target_user:target_pass@target_db:5432/target_files"
    target_storage_path: Path = Path("/app/target-storage")
    # Number of files to copy concurrently (I/O-bound — threads, not processes)
    copy_concurrency: int = 8

    @property
    def contentstore_path(self) -> Path:
        return self.alf_data_path / "contentstore"

    model_config = {
        "env_file": ["../env/backend.env", ".env"],
        "env_file_encoding": "utf-8",
        "env_ignore_empty": True,
    }


settings = Settings()
