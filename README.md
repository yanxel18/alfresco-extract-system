# 📦 Alfresco Extract System

A tool to bulk-extract all files and metadata from **Alfresco Community Edition** sites directly from the database and local file storage — no Alfresco API needed. Designed for migrating 50,000+ files (videos, images, PDFs, Excel, etc.) into a new system.

## Current Deployment Notes

- The Alfresco source PostgreSQL is always queried in **read-only** mode.
- The Alfresco `alf_data` / `contentstore` source is always mounted **read-only**.
- For **Docker Desktop on Windows** against an Alfresco server running outside Docker, mount the remote `alf_data` share as a **Docker CIFS/SMB volume**. Do not rely on a Windows user-mapped drive such as `Z:` inside the container.
- When the contentstore is remote SMB/CIFS, keep `COPY_CONCURRENCY=1` unless you have verified that a higher value is stable in that environment.
- Alfresco shortcut-like nodes are handled conservatively:
  - file-target shortcuts can still resolve to real files
  - folder-target shortcuts are shown as **shortcuts**, not as real child folders, and are not extracted inline

## External Alfresco Checklist

- `ALFRESCO_DB_URL` points to the external Alfresco PostgreSQL server.
- `ALFRESCO_API_URL` points to the external Alfresco application server.
- PostgreSQL `pg_hba.conf` allows connections from the **Docker subnet**, not just from the Windows host tools.
- The Docker-mounted `alf_data` share exposes the real `contentstore/` directory layout expected by Alfresco.
