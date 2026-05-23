-- =============================================================================
-- Simulated target file-manager database schema
-- =============================================================================
-- ⚠️  PLACEHOLDER SCHEMA — update column names/types once the real target
--    system's schema is provided by the company.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Folders: ID-based hierarchy (no physical path on disk).
-- parent_id NULL means a root-level folder.
CREATE TABLE IF NOT EXISTS folders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id   UUID REFERENCES folders(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- NULL-safe unique indexes: PostgreSQL UNIQUE constraints treat NULL != NULL,
-- so we use two partial indexes to enforce uniqueness correctly.
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_root_unique
    ON folders (name) WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_child_unique
    ON folders (parent_id, name) WHERE parent_id IS NOT NULL;

-- Files: stored on disk as UUID-named files; original name preserved in DB.
CREATE TABLE IF NOT EXISTS files (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    folder_id         UUID REFERENCES folders(id) ON DELETE SET NULL,
    uuid_filename     VARCHAR(300) NOT NULL,   -- physical filename on disk, e.g. "550e8400-...-.pdf"
    original_name     VARCHAR(500) NOT NULL,   -- original filename from Alfresco
    title             VARCHAR(500),
    description       TEXT,
    mime_type         VARCHAR(100),
    file_size_bytes   BIGINT,
    creator           VARCHAR(255),
    modifier          VARCHAR(255),
    created_at        TIMESTAMP,              -- original creation time from Alfresco
    modified_at       TIMESTAMP,             -- original modified time from Alfresco
    tags              TEXT,                   -- comma-separated tags from Alfresco
    source_node_ref   VARCHAR(255),           -- Alfresco node ref for traceability
    source_site       VARCHAR(255),           -- Alfresco site short name
    migrated_at       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_files_folder_id     ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_uuid_filename ON files(uuid_filename);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id   ON folders(parent_id);
