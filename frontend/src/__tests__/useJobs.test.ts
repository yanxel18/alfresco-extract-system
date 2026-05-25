jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      jobs: {
        ...actual.api.jobs,
        list: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        startCopy: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        delete: jest.fn(),
      },
      files: {
        ...actual.api.files,
        list: jest.fn(),
      },
      migration: {
        ...actual.api.migration,
        start: jest.fn(),
        get: jest.fn(),
        pause: jest.fn(),
        resume: jest.fn(),
        revert: jest.fn(),
      },
    },
  };
});

import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { api, type Job } from "@/api/client";
import {
  useCreateJob,
  useDeleteJob,
  useJob,
  useJobAction,
  useJobFiles,
  useJobs,
  useMigration,
  useMigrationActions,
} from "@/hooks/useJobs";
import { createTestQueryClient, Providers } from "./testUtils";

const job: Job = {
  id: 1,
  site_name: "alpha",
  status: "scanning",
  total_files: 10,
  scanned_files: 5,
  copied_files: 2,
  failed_files: 0,
  total_size_bytes: 100,
  copied_size_bytes: 20,
  copy_started_at: null,
  migration_started_at: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

describe("useJobs hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queries jobs and a single job", async () => {
    (api.jobs.list as jest.MockedFunction<typeof api.jobs.list>).mockResolvedValue([job]);
    (api.jobs.get as jest.MockedFunction<typeof api.jobs.get>).mockResolvedValue(job);
    const client = createTestQueryClient();

    const jobsHook = renderHook(() => useJobs(), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });
    const jobHook = renderHook(() => useJob(1), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await waitFor(() => expect(jobsHook.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(jobHook.result.current.isSuccess).toBe(true));

    expect(jobsHook.result.current.data).toEqual([job]);
    expect(jobHook.result.current.data?.status).toBe("scanning");
  });

  it("creates and deletes jobs while invalidating the jobs query", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");
    (api.jobs.create as jest.MockedFunction<typeof api.jobs.create>).mockResolvedValue(job);
    (api.jobs.delete as jest.MockedFunction<typeof api.jobs.delete>).mockResolvedValue(undefined);

    const createHook = renderHook(() => useCreateJob(), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });
    const deleteHook = renderHook(() => useDeleteJob(), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await act(async () => {
      await createHook.result.current.mutateAsync({ site_name: "alpha" });
      await deleteHook.result.current.mutateAsync(1);
    });

    expect(api.jobs.create).toHaveBeenCalledWith({ site_name: "alpha" });
    expect(api.jobs.delete).toHaveBeenCalledWith(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs"] });
  });

  it("runs job actions and invalidates job-specific queries", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");
    (api.jobs.startCopy as jest.MockedFunction<typeof api.jobs.startCopy>).mockResolvedValue(job);
    (api.jobs.pause as jest.MockedFunction<typeof api.jobs.pause>).mockResolvedValue({ ...job, status: "paused" });
    (api.jobs.resume as jest.MockedFunction<typeof api.jobs.resume>).mockResolvedValue({ ...job, status: "copying" });

    const { result } = renderHook(() => useJobAction(1), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await act(async () => {
      await result.current.startCopy.mutateAsync();
      await result.current.pause.mutateAsync();
      await result.current.resume.mutateAsync();
    });

    expect(api.jobs.startCopy).toHaveBeenCalledWith(1);
    expect(api.jobs.pause).toHaveBeenCalledWith(1);
    expect(api.jobs.resume).toHaveBeenCalledWith(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs", 1] });
  });

  it("loads file pages and migration records using the provided arguments", async () => {
    const client = createTestQueryClient();
    (api.files.list as jest.MockedFunction<typeof api.files.list>).mockResolvedValue({ total: 1, files: [] });
    (api.migration.get as jest.MockedFunction<typeof api.migration.get>).mockResolvedValue({
      job_id: 1,
      status: "migrating",
      total: 3,
      total_records: 3,
      migrated: 1,
      failed: 0,
      pending: 2,
      skipped: 0,
      migration_started_at: null,
      records: [],
    });

    const filesHook = renderHook(() => useJobFiles(1, 2, 50, "failed", "copying"), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });
    const migrationHook = renderHook(() => useMigration(1, "migrated", 3, 20), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await waitFor(() => expect(filesHook.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(migrationHook.result.current.isSuccess).toBe(true));

    expect(api.files.list).toHaveBeenCalledWith(1, { status: "failed", limit: 50, offset: 50 });
    expect(api.migration.get).toHaveBeenCalledWith(1, 3, 20);
  });

  it("disables migration queries for pre-copy job states", async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(() => useMigration(1, "copying"), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(api.migration.get).not.toHaveBeenCalled();
  });

  it("runs migration actions and invalidates all related queries", async () => {
    const client = createTestQueryClient();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");
    (api.migration.start as jest.MockedFunction<typeof api.migration.start>).mockResolvedValue({
      job_id: 1,
      status: "migrating",
      total: 1,
      total_records: 1,
      migrated: 0,
      failed: 0,
      pending: 1,
      skipped: 0,
      migration_started_at: null,
      records: [],
    });
    (api.migration.pause as jest.MockedFunction<typeof api.migration.pause>).mockResolvedValue({
      job_id: 1,
      status: "paused",
      total: 1,
      total_records: 1,
      migrated: 0,
      failed: 0,
      pending: 1,
      skipped: 0,
      migration_started_at: null,
      records: [],
    });
    (api.migration.resume as jest.MockedFunction<typeof api.migration.resume>).mockResolvedValue({
      job_id: 1,
      status: "migrating",
      total: 1,
      total_records: 1,
      migrated: 0,
      failed: 0,
      pending: 1,
      skipped: 0,
      migration_started_at: null,
      records: [],
    });
    (api.migration.revert as jest.MockedFunction<typeof api.migration.revert>).mockResolvedValue({
      job_id: 1,
      status: "done",
      total: 1,
      total_records: 1,
      migrated: 0,
      failed: 0,
      pending: 1,
      skipped: 0,
      migration_started_at: null,
      records: [],
    });

    const { result } = renderHook(() => useMigrationActions(1), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await act(async () => {
      await result.current.start.mutateAsync();
      await result.current.pause.mutateAsync();
      await result.current.resume.mutateAsync();
      await result.current.revert.mutateAsync();
    });

    expect(api.migration.start).toHaveBeenCalledWith(1);
    expect(api.migration.pause).toHaveBeenCalledWith(1);
    expect(api.migration.resume).toHaveBeenCalledWith(1);
    expect(api.migration.revert).toHaveBeenCalledWith(1);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs", 1, "migration"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["jobs"] });
  });
});
