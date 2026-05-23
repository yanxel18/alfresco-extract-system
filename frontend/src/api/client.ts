// Typed API client for the Alfresco Extract System backend.
// All functions use the relative /api path — Vite proxy handles dev, nginx handles production.

export type JobStatus =
  | "created"
  | "scanning"
  | "scanned"
  | "copying"
  | "done"
  | "paused"
  | "failed"
  | "migrating"
  | "migrated";

export type FileStatus = "pending" | "copied" | "failed" | "skipped";

export interface Site {
  short_name: string;
  title: string;
  description?: string;
  node_ref?: string;
}

export interface Job {
  id: number;
  site_name: string;
  site_title?: string;
  status: JobStatus;
  total_files: number;
  scanned_files: number;
  copied_files: number;
  failed_files: number;
  total_size_bytes: number;
  copied_size_bytes: number;
  copy_started_at: string | null;
  celery_task_id?: string;
  error_msg?: string;
  selected_folders?: string;
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: number;
  node_ref: string;
  site: string;
  full_path: string;
  file_name: string;
  title?: string;
  description?: string;
  creator?: string;
  modifier?: string;
  created_at?: string;
  modified_at?: string;
  mime_type?: string;
  file_size_bytes?: number;
  version?: string;
  tags?: string;
  categories?: string;
  content_url?: string;
  status: FileStatus;
  local_export_path?: string;
  error_msg?: string;
  transfer_speed_bps?: number | null;
}

export type MigrationStatus = "pending" | "migrated" | "failed" | "skipped";

export interface MigrationRecord {
  id: number;
  job_id: number;
  file_record_id: number;
  target_file_id: string | null;
  target_folder_id: string | null;
  uuid_filename: string | null;
  status: MigrationStatus;
  error_msg: string | null;
  migrated_at: string | null;
  original_name: string | null;
  original_path: string | null;
}

export interface MigrationProgress {
  job_id: number;
  status: string;
  total: number;
  total_records: number;
  migrated: number;
  failed: number;
  pending: number;
  skipped: number;
  records: MigrationRecord[];
}

export interface FolderSizeResult {
  node_id: number;
  total_size_bytes: number;
}

export interface FolderNode {
  node_id: number;
  name: string;
  has_children: boolean;
}

export interface FileNodeBrief {
  node_id: number;
  name: string;
  mime_type?: string;
  size_bytes?: number;
  modifier?: string;
  modified_at?: string;
}

export interface BrowseResult {
  site_name: string;
  current_node_id: number;
  parent_node_id?: number;
  folders: FolderNode[];
  files: FileNodeBrief[];
}

export interface FileRecordPage {
  total: number;
  files: FileRecord[];
}

export interface JobCreate {
  site_name: string;
  selected_folder_node_ids?: number[];
  selected_file_node_ids?: number[];
  excluded_file_node_ids?: number[];
}

export interface HealthStatus {
  api: string;
  redis: string;
  alfresco_db: string;
}

// ---------------------------------------------------------------------------

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

const BASE = "/api";

export const api = {
  health: {
    get: () => request<HealthStatus>(`${BASE}/health`),
  },

  sites: {
    list: () => request<Site[]>(`${BASE}/sites`),
  },

  browse: {
    get: (siteName: string, parentId?: number) => {
      const url =
        parentId !== undefined
          ? `${BASE}/sites/${encodeURIComponent(siteName)}/browse?parent_id=${parentId}`
          : `${BASE}/sites/${encodeURIComponent(siteName)}/browse`;
      return request<BrowseResult>(url);
    },
    search: (siteName: string, q: string, limit = 50) =>
      request<FileNodeBrief[]>(
        `${BASE}/sites/${encodeURIComponent(siteName)}/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      ),
    folderSize: (siteName: string, nodeIds: number[]) => {
      const qs = nodeIds.map((id) => `node_ids=${id}`).join("&");
      return request<FolderSizeResult[]>(
        `${BASE}/sites/${encodeURIComponent(siteName)}/folder-size?${qs}`,
      );
    },
  },

  jobs: {
    list: () => request<Job[]>(`${BASE}/jobs`),
    get: (id: number) => request<Job>(`${BASE}/jobs/${id}`),
    create: (payload: JobCreate) =>
      request<Job>(`${BASE}/jobs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    startCopy: (id: number) =>
      request<Job>(`${BASE}/jobs/${id}/start-copy`, { method: "POST" }),
    pause: (id: number) =>
      request<Job>(`${BASE}/jobs/${id}/pause`, { method: "POST" }),
    resume: (id: number) =>
      request<Job>(`${BASE}/jobs/${id}/resume`, { method: "POST" }),
    delete: (id: number) =>
      fetch(`${BASE}/jobs/${id}`, { method: "DELETE" }).then((res) => {
        if (!res.ok) throw new Error(`API ${res.status}`);
      }),
  },

  files: {
    list: (
      jobId: number,
      params?: { status?: FileStatus; limit?: number; offset?: number },
    ) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.limit !== undefined) qs.set("limit", String(params.limit));
      if (params?.offset !== undefined) qs.set("offset", String(params.offset));
      return request<FileRecordPage>(`${BASE}/jobs/${jobId}/files?${qs}`);
    },
    csvUrl: (jobId: number) => `${BASE}/jobs/${jobId}/csv`,
  },
  migration: {
    start: (id: number) =>
      request<MigrationProgress>(`${BASE}/jobs/${id}/migrate`, {
        method: "POST",
      }),
    get: (id: number, page = 1, limit = 100) =>
      request<MigrationProgress>(
        `${BASE}/jobs/${id}/migration?page=${page}&limit=${limit}`,
      ),
    pause: (id: number) =>
      request<MigrationProgress>(`${BASE}/jobs/${id}/migration/pause`, {
        method: "POST",
      }),
    resume: (id: number) =>
      request<MigrationProgress>(`${BASE}/jobs/${id}/migration/resume`, {
        method: "POST",
      }),
    sqlUrl: (id: number) => `${BASE}/jobs/${id}/migration/sql`,
    revert: (id: number) =>
      request<MigrationProgress>(`${BASE}/jobs/${id}/migration`, { method: "DELETE" }),
  },
};
