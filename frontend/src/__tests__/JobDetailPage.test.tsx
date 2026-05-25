const mockNavigate = jest.fn();
const mockUseJob = jest.fn();
const mockUseJobFiles = jest.fn();
const mockUseJobAction = jest.fn();
const mockUseDeleteJob = jest.fn();
const mockUseMigration = jest.fn();
const mockUseMigrationActions = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
  useParams: () => ({ jobId: "7" }),
}));

jest.mock("@/hooks/useJobs", () => ({
  useJob: (...args: unknown[]) => mockUseJob(...args),
  useJobFiles: (...args: unknown[]) => mockUseJobFiles(...args),
  useJobAction: (...args: unknown[]) => mockUseJobAction(...args),
  useDeleteJob: () => mockUseDeleteJob(),
  useMigration: (...args: unknown[]) => mockUseMigration(...args),
  useMigrationActions: (...args: unknown[]) => mockUseMigrationActions(...args),
}));

jest.mock("@mantine/notifications", () => ({
  notifications: { show: jest.fn() },
}));

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import type { Job, MigrationProgress } from "@/api/client";
import { JobDetailPage } from "@/pages/JobDetailPage";
import { Providers } from "./testUtils";

const mockShow = notifications.show as jest.Mock;

function buildJob(status: Job["status"]): Job {
  return {
    id: 7,
    site_name: "alpha",
    site_title: "Alpha",
    status,
    total_files: 10,
    scanned_files: status === "scanning" ? 4 : 10,
    copied_files: status === "done" || status === "migrating" || status === "migrated" ? 8 : 2,
    failed_files: status === "failed" ? 1 : 0,
    total_size_bytes: 10 * 1024,
    copied_size_bytes: status === "copying" ? 5 * 1024 : 8 * 1024,
    copy_started_at: "2024-01-01T00:00:00",
    migration_started_at: "2024-01-01T00:10:00",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:15:00Z",
  };
}

function buildMigration(overrides: Partial<MigrationProgress> = {}): MigrationProgress {
  return {
    job_id: 7,
    status: "migrating",
    total: 2,
    total_records: 2,
    migrated: 1,
    failed: 0,
    pending: 1,
    skipped: 0,
    migration_started_at: "2024-01-01T00:10:00",
    records: [
      {
        id: 1,
        job_id: 7,
        file_record_id: 10,
        target_file_id: "file-1",
        target_folder_id: "folder-1",
        uuid_filename: "uuid-1",
        status: "pending",
        error_msg: null,
        migrated_at: null,
        duration_ms: 750,
        original_name: "alpha.txt",
        original_path: "/Sites/alpha.txt",
      },
      {
        id: 2,
        job_id: 7,
        file_record_id: 11,
        target_file_id: null,
        target_folder_id: null,
        uuid_filename: null,
        status: "failed",
        error_msg: "bad row",
        migrated_at: "2024-01-01T00:12:00",
        duration_ms: 1500,
        original_name: null,
        original_path: null,
      },
    ],
    ...overrides,
  };
}

describe("JobDetailPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    jest.spyOn(Date, "now").mockReturnValue(new Date("2024-01-01T00:20:00Z").getTime());
    mockUseJobAction.mockReturnValue({
      startCopy: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
      pause: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
      resume: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
    });
    mockUseDeleteJob.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false });
    mockUseMigrationActions.mockReturnValue({
      start: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
      pause: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
      resume: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
      revert: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
    });
    mockUseJob.mockReturnValue({ data: buildJob("scanned"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseJobFiles.mockReturnValue({
      data: {
        total: 2,
        files: [
          {
            id: 1,
            node_ref: "1",
            site: "alpha",
            full_path: "/Sites/one.pdf",
            file_name: "one.pdf",
            mime_type: "application/pdf",
            file_size_bytes: 1024,
            status: "copied",
            transfer_speed_bps: 2048,
          },
          {
            id: 2,
            node_ref: "2",
            site: "alpha",
            full_path: "/Sites/two.txt",
            file_name: "two.txt",
            mime_type: "text/plain",
            file_size_bytes: 0,
            status: "failed",
            error_msg: "copy failed",
            transfer_speed_bps: 0,
          },
        ],
      },
      isPending: false,
      refetch: jest.fn(),
    });
    mockUseMigration.mockReturnValue({ data: buildMigration(), refetch: jest.fn() });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders an error alert", () => {
    mockUseJob.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch: jest.fn() });
    render(<JobDetailPage />, { wrapper: Providers });
    expect(screen.getByText("An error occurred")).toBeInTheDocument();
  });

  it("renders loading placeholders and empty file state", () => {
    mockUseJob.mockReturnValue({ data: undefined, isPending: true, isError: false, refetch: jest.fn() });
    mockUseJobFiles.mockReturnValue({ data: { total: 0, files: [] }, isPending: true, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({ data: undefined, refetch: jest.fn() });
    const { container } = render(<JobDetailPage />, { wrapper: Providers });
    expect(container.querySelectorAll(".mantine-Skeleton-root").length).toBeGreaterThan(1);
  });

  it("renders scanned jobs and starts copy", async () => {
    const startCopy = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    const refetchJob = jest.fn();
    const refetchFiles = jest.fn();
    mockUseJobAction.mockReturnValue({
      startCopy,
      pause: { mutateAsync: jest.fn(), isPending: false },
      resume: { mutateAsync: jest.fn(), isPending: false },
    });
    mockUseJob.mockReturnValue({ data: buildJob("scanned"), isPending: false, isError: false, refetch: refetchJob });
    mockUseJobFiles.mockReturnValue({ data: { total: 2, files: [] }, isPending: false, refetch: refetchFiles });
    mockUseMigration.mockReturnValue({ data: buildMigration({ total: 0, total_records: 0, records: [] }), refetch: jest.fn() });

    render(<JobDetailPage />, { wrapper: Providers });

    expect(screen.getByText("Job Details #7")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Copy" }));
    await waitFor(() => expect(startCopy.mutateAsync).toHaveBeenCalled());
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ color: "violet" }));

    fireEvent.click(screen.getAllByRole("button", { name: "" }).slice(-1)[0]);
    expect(refetchJob).toHaveBeenCalled();
    expect(refetchFiles).toHaveBeenCalled();
    expect(screen.getByText("No files match the selected filter.")).toBeInTheDocument();
  });

  it("renders copying jobs with file progress and pause action", async () => {
    jest.useFakeTimers();
    const pause = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    mockUseJobAction.mockReturnValue({
      startCopy: { mutateAsync: jest.fn(), isPending: false },
      pause,
      resume: { mutateAsync: jest.fn(), isPending: false },
    });
    mockUseJob.mockReturnValue({ data: buildJob("copying"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseJobFiles.mockReturnValue({
      data: {
        total: 2,
        files: [
          {
            id: 1,
            node_ref: "1",
            site: "alpha",
            full_path: "/Sites/one.pdf",
            file_name: "one.pdf",
            mime_type: "application/pdf",
            file_size_bytes: 1024,
            status: "pending",
            transfer_speed_bps: 4096,
          },
        ],
      },
      isPending: false,
      refetch: jest.fn(),
    });

    render(<JobDetailPage />, { wrapper: Providers });
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getAllByText("Copying").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Calculating…").length).toBeGreaterThan(0);
    expect(screen.getByText("4.0 KB/s")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(pause.mutateAsync).toHaveBeenCalled());
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ color: "orange" }));
  });

  it("renders paused jobs with resume and delete controls", async () => {
    const resume = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    const deleteJob = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    mockUseJobAction.mockReturnValue({
      startCopy: { mutateAsync: jest.fn(), isPending: false },
      pause: { mutateAsync: jest.fn(), isPending: false },
      resume,
    });
    mockUseDeleteJob.mockReturnValue(deleteJob);
    mockUseJob.mockReturnValue({ data: buildJob("paused"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({ data: buildMigration({ status: "paused" }), refetch: jest.fn() });

    render(<JobDetailPage />, { wrapper: Providers });

    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(resume.mutateAsync).toHaveBeenCalled());
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ color: "cyan" }));

    fireEvent.click(screen.getByRole("button", { name: "Delete Job" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete Job" }));
    await waitFor(() => expect(deleteJob.mutateAsync).toHaveBeenCalledWith(7));
    expect(mockNavigate).toHaveBeenCalledWith("/jobs");
  });

  it("renders migration controls, records, and revert flow", async () => {
    const start = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    const revert = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    mockUseMigrationActions.mockReturnValue({
      start,
      pause: { mutateAsync: jest.fn(), isPending: false },
      resume: { mutateAsync: jest.fn(), isPending: false },
      revert,
    });
    mockUseJob.mockReturnValue({ data: buildJob("done"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({
      data: buildMigration({ status: "done", migrated: 2, pending: 0, skipped: 1 }),
      refetch: jest.fn(),
    });

    render(<JobDetailPage />, { wrapper: Providers });
    fireEvent.click(screen.getByRole("tab", { name: /Migration/i }));

    expect(await screen.findByText("Download SQL Script")).toBeInTheDocument();
    expect(screen.getByText("alpha.txt")).toBeInTheDocument();
    expect(screen.getByText("bad row")).toBeInTheDocument();
    expect(screen.getByText("1.5s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Migration" }));
    await waitFor(() => expect(start.mutateAsync).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Revert Migration" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revert Migration" }));
    await waitFor(() => expect(revert.mutateAsync).toHaveBeenCalled());
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ color: "red" }));
  });

  it("renders migrating and not-started migration states", async () => {
    const pause = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    mockUseMigrationActions.mockReturnValue({
      start: { mutateAsync: jest.fn(), isPending: false },
      pause,
      resume: { mutateAsync: jest.fn(), isPending: false },
      revert: { mutateAsync: jest.fn(), isPending: false },
    });
    mockUseJob.mockReturnValue({ data: buildJob("migrating"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({ data: buildMigration({ status: "migrating" }), refetch: jest.fn() });

    const { rerender } = render(<JobDetailPage />, { wrapper: Providers });
    fireEvent.click(screen.getByRole("tab", { name: /Migration/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(pause.mutateAsync).toHaveBeenCalled());

    mockUseJob.mockReturnValue({ data: buildJob("done"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({
      data: { ...buildMigration({ total: 0, total_records: 0, records: [] }), total: 0, total_records: 0, records: [] },
      refetch: jest.fn(),
    });
    rerender(<JobDetailPage />);
    fireEvent.click(screen.getByRole("tab", { name: /Migration/i }));
    expect(await screen.findByText("Migration has not been started yet.")).toBeInTheDocument();
  });

  it("handles failed job and migration actions", async () => {
    const refetchMigration = jest.fn();
    const startCopy = { mutateAsync: jest.fn().mockRejectedValue(new Error("no start")), isPending: false };
    const pause = { mutateAsync: jest.fn().mockRejectedValue(new Error("no pause")), isPending: false };
    const resume = { mutateAsync: jest.fn().mockRejectedValue(new Error("no resume")), isPending: false };
    const deleteJob = { mutateAsync: jest.fn().mockRejectedValue(new Error("no delete")), isPending: false };
    const migrationActions = {
      start: { mutateAsync: jest.fn().mockRejectedValue(new Error("no migrate")), isPending: false },
      pause: { mutateAsync: jest.fn().mockRejectedValue(new Error("no migrate pause")), isPending: false },
      resume: { mutateAsync: jest.fn().mockRejectedValue(new Error("no migrate resume")), isPending: false },
      revert: { mutateAsync: jest.fn().mockRejectedValue(new Error("no revert")), isPending: false },
    };
    mockUseJobAction.mockReturnValue({ startCopy, pause, resume });
    mockUseDeleteJob.mockReturnValue(deleteJob);
    mockUseMigrationActions.mockReturnValue(migrationActions);
    mockUseJob.mockReturnValue({ data: buildJob("scanned"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({ data: buildMigration({ status: "done", migrated: 1 }), refetch: refetchMigration });

    const { rerender } = render(<JobDetailPage />, { wrapper: Providers });
    fireEvent.click(screen.getAllByRole("button", { name: "" })[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/jobs");

    fireEvent.click(screen.getByRole("button", { name: "Start Copy" }));
    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ message: "Action failed", color: "red" })));

    mockUseJob.mockReturnValue({ data: buildJob("copying"), isPending: false, isError: false, refetch: jest.fn() });
    rerender(<JobDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(pause.mutateAsync).toHaveBeenCalled());

    mockUseJob.mockReturnValue({ data: buildJob("paused"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({ data: buildMigration({ status: "paused", migrated: 1 }), refetch: refetchMigration });
    rerender(<JobDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(resume.mutateAsync).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Delete Job" }));
    const deleteDialog = await screen.findByRole("dialog");
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Delete Job" }));
    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ message: "Failed to delete job", color: "red" })));
    fireEvent.click(within(deleteDialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("tab", { name: /Migration/i }));
    fireEvent.click(screen.getAllByRole("button", { name: "Resume" }).slice(-1)[0]);
    await waitFor(() => expect(migrationActions.resume.mutateAsync).toHaveBeenCalled());

    mockUseJob.mockReturnValue({ data: buildJob("done"), isPending: false, isError: false, refetch: jest.fn() });
    mockUseMigration.mockReturnValue({ data: buildMigration({ status: "done", migrated: 1 }), refetch: refetchMigration });
    rerender(<JobDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Start Migration" }));
    await waitFor(() => expect(migrationActions.start.mutateAsync).toHaveBeenCalled());

    expect(refetchMigration).not.toHaveBeenCalled();
  });
});
