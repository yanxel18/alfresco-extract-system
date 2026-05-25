jest.mock("@/api/client", () => jest.requireActual("@/api/client"));

import { api, type BrowseResult, type FileNodeBrief, type Job, type MigrationProgress, type Site } from "@/api/client";

describe("api client", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it("returns parsed JSON for successful requests", async () => {
    const payload = { api: "ok", redis: "ok", alfresco_db: "ok" };
    fetchMock.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue(payload) });

    await expect(api.health.get()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith("/api/health", undefined);
  });

  it("throws a detailed HTTP error when the response body is available", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: jest.fn().mockResolvedValue("boom"),
    });

    await expect(api.sites.list()).rejects.toThrow("API 500: boom");
  });

  it("falls back to statusText when reading the response body fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Missing",
      text: jest.fn().mockRejectedValue(new Error("no text")),
    });

    await expect(api.jobs.get(1)).rejects.toThrow("API 404: Missing");
  });

  it("surfaces network errors", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(api.jobs.list()).rejects.toThrow("network down");
  });

  it("builds browse, file, and migration URLs correctly", async () => {
    const browseResult: BrowseResult = {
      site_name: "My Site",
      current_node_id: 1,
      parent_node_id: 0,
      folders: [],
      files: [],
    };
    const fileNode: FileNodeBrief[] = [];
    const folderSizes = [{ node_id: 11, total_size_bytes: 123 }];
    const filePage = { total: 0, files: [] };
    const migration: MigrationProgress = {
      job_id: 7,
      status: "migrating",
      total: 2,
      total_records: 2,
      migrated: 1,
      failed: 0,
      pending: 1,
      skipped: 0,
      migration_started_at: null,
      records: [],
    };

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(browseResult) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(browseResult) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(fileNode) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(folderSizes) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(filePage) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(migration) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(migration) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(migration) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(migration) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(migration) });

    await api.browse.get("My Site");
    await api.browse.get("My Site", 99);
    await api.browse.search("My Site", "annual report", 25);
    await api.browse.folderSize("My Site", [11, 12]);
    await api.files.list(9, { status: "failed", limit: 10, offset: 20 });
    await api.migration.start(7);
    await api.migration.get(7, 3, 40);
    await api.migration.pause(7);
    await api.migration.resume(7);
    await api.migration.revert(7);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/sites/My%20Site/browse", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/sites/My%20Site/browse?parent_id=99", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/sites/My%20Site/search?q=annual%20report&limit=25", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/sites/My%20Site/folder-size?node_ids=11&node_ids=12", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/jobs/9/files?status=failed&limit=10&offset=20", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/jobs/7/migrate", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/jobs/7/migration?page=3&limit=40", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(8, "/api/jobs/7/migration/pause", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(9, "/api/jobs/7/migration/resume", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(10, "/api/jobs/7/migration", { method: "DELETE" });
    expect(api.files.csvUrl(9)).toBe("/api/jobs/9/csv");
    expect(api.migration.sqlUrl(7)).toBe("/api/jobs/7/migration/sql");
  });

  it("covers site and job CRUD helpers", async () => {
    const sites: Site[] = [{ short_name: "s1", title: "Site 1" }];
    const job: Job = {
      id: 5,
      site_name: "s1",
      site_title: "Site 1",
      status: "scanned",
      total_files: 10,
      scanned_files: 10,
      copied_files: 2,
      failed_files: 1,
      total_size_bytes: 1000,
      copied_size_bytes: 200,
      copy_started_at: null,
      migration_started_at: null,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    };

    fetchMock
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(sites) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(job) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(job) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(job) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(job) })
      .mockResolvedValueOnce({ ok: true, json: jest.fn().mockResolvedValue(job) })
      .mockResolvedValueOnce({ ok: true });

    await expect(api.sites.list()).resolves.toEqual(sites);
    await expect(api.jobs.list()).resolves.toEqual(job);
    await expect(
      api.jobs.create({ site_name: "s1", selected_folder_node_ids: [1], selected_file_node_ids: [2], excluded_file_node_ids: [3] }),
    ).resolves.toEqual(job);
    await expect(api.jobs.startCopy(5)).resolves.toEqual(job);
    await expect(api.jobs.pause(5)).resolves.toEqual(job);
    await expect(api.jobs.resume(5)).resolves.toEqual(job);
    await expect(api.jobs.delete(5)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/sites", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/jobs", undefined);
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        site_name: "s1",
        selected_folder_node_ids: [1],
        selected_file_node_ids: [2],
        excluded_file_node_ids: [3],
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/jobs/5/start-copy", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(5, "/api/jobs/5/pause", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(6, "/api/jobs/5/resume", { method: "POST" });
    expect(fetchMock).toHaveBeenNthCalledWith(7, "/api/jobs/5", { method: "DELETE" });
  });

  it("throws on failed delete", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });

    await expect(api.jobs.delete(9)).rejects.toThrow("API 403");
  });
});
