const mockNavigate = jest.fn();
const mockUseJobs = jest.fn();
const mockUseJobAction = jest.fn();
const mockUseDeleteJob = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

jest.mock("@/hooks/useJobs", () => ({
  useJobs: () => mockUseJobs(),
  useJobAction: (id: number) => mockUseJobAction(id),
  useDeleteJob: () => mockUseDeleteJob(),
}));

jest.mock("@mantine/notifications", () => ({
  notifications: { show: jest.fn() },
}));

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { JobsPage } from "@/pages/JobsPage";
import type { Job } from "@/api/client";
import { Providers } from "./testUtils";

const mockShow = notifications.show as jest.Mock;

function buildJob(id: number, status: Job["status"]): Job {
  return {
    id,
    site_name: `site-${id}`,
    site_title: `Site ${id}`,
    status,
    total_files: 10,
    scanned_files: status === "scanning" ? 5 : 10,
    copied_files: status === "done" ? 10 : 2,
    failed_files: status === "failed" ? 1 : 0,
    total_size_bytes: 1000,
    copied_size_bytes: 200,
    copy_started_at: "2024-01-01T00:00:00Z",
    migration_started_at: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:05:00Z",
  };
}

describe("JobsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDeleteJob.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false });
    mockUseJobAction.mockImplementation(() => ({
      startCopy: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
      pause: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
      resume: { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false },
    }));
  });

  it("renders loading, error, and empty states", () => {
    mockUseJobs.mockReturnValue({ data: [], isPending: true, isError: false, refetch: jest.fn() });
    const { rerender, container } = render(<JobsPage />, { wrapper: Providers });
    expect(container.querySelectorAll(".mantine-Skeleton-root")).toHaveLength(5);

    mockUseJobs.mockReturnValue({ data: [], isPending: false, isError: true, refetch: jest.fn() });
    rerender(<JobsPage />);
    expect(screen.getByText("An error occurred")).toBeInTheDocument();

    mockUseJobs.mockReturnValue({ data: [], isPending: false, isError: false, refetch: jest.fn() });
    rerender(<JobsPage />);
    expect(screen.getByText("No extraction jobs yet.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "New Job" })[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/sites");
  });

  it("renders rows and performs row actions", async () => {
    const refetch = jest.fn();
    const startCopy = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    const pause = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    const resume = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    const deleteJob = { mutateAsync: jest.fn().mockResolvedValue(undefined), isPending: false };
    mockUseDeleteJob.mockReturnValue(deleteJob);
    mockUseJobAction
      .mockReturnValueOnce({ startCopy, pause, resume })
      .mockReturnValueOnce({ startCopy, pause, resume })
      .mockReturnValueOnce({ startCopy, pause, resume })
      .mockReturnValueOnce({ startCopy, pause, resume });
    mockUseJobs.mockReturnValue({
      data: [buildJob(1, "scanned"), buildJob(2, "scanning"), buildJob(3, "paused"), buildJob(4, "done")],
      isPending: false,
      isError: false,
      refetch,
    });

    render(<JobsPage />, { wrapper: Providers });

    expect(screen.getByText("4 total")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(refetch).toHaveBeenCalled();

    const rows = screen.getAllByRole("row");
    const scannedRow = rows.find((row) => within(row).queryByText("#1")) as HTMLElement;
    const scanningRow = rows.find((row) => within(row).queryByText("#2")) as HTMLElement;
    const pausedRow = rows.find((row) => within(row).queryByText("#3")) as HTMLElement;
    const doneRow = rows.find((row) => within(row).queryByText("#4")) as HTMLElement;

    fireEvent.click(within(scannedRow).getAllByRole("button")[1]);
    await waitFor(() => expect(startCopy.mutateAsync).toHaveBeenCalled());
    fireEvent.click(within(scanningRow).getAllByRole("button")[1]);
    await waitFor(() => expect(pause.mutateAsync).toHaveBeenCalled());
    fireEvent.click(within(pausedRow).getAllByRole("button")[1]);
    await waitFor(() => expect(resume.mutateAsync).toHaveBeenCalled());

    fireEvent.click(within(doneRow).getAllByRole("button")[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/jobs/4");

    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ color: "green" }));
  });
});
