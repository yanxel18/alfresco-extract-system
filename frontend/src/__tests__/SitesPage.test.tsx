const mockNavigate = jest.fn();
const mockUseSites = jest.fn();
const mockUseCreateJob = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

jest.mock("@/hooks/useSites", () => ({
  useSites: () => mockUseSites(),
}));

jest.mock("@/hooks/useJobs", () => ({
  useCreateJob: () => mockUseCreateJob(),
}));

jest.mock("@mantine/notifications", () => ({
  notifications: { show: jest.fn() },
}));

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { SitesPage } from "@/pages/SitesPage";
import { Providers } from "./testUtils";

const mockShow = notifications.show as jest.Mock;

describe("SitesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders loading, error, and empty states", () => {
    mockUseCreateJob.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
    mockUseSites.mockReturnValue({ data: [], isPending: true, isError: false, refetch: jest.fn() });
    const { rerender, container } = render(<SitesPage />, { wrapper: Providers });
    expect(container.querySelectorAll(".mantine-Skeleton-root")).toHaveLength(6);

    mockUseSites.mockReturnValue({ data: [], isPending: false, isError: true, refetch: jest.fn() });
    rerender(<SitesPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("An error occurred");

    mockUseSites.mockReturnValue({ data: [], isPending: false, isError: false, refetch: jest.fn() });
    rerender(<SitesPage />);
    expect(screen.getByText("No Alfresco sites found.")).toBeInTheDocument();
  });

  it("filters sites, retries, and browses to the explorer", () => {
    const refetch = jest.fn();
    mockUseCreateJob.mockReturnValue({ mutateAsync: jest.fn(), isPending: false });
    mockUseSites.mockReturnValue({
      data: [
        { short_name: "alpha", title: "Alpha Site", description: "First" },
        { short_name: "beta", title: "Beta Site", description: "Second" },
      ],
      isPending: false,
      isError: false,
      refetch,
    });

    render(<SitesPage />, { wrapper: Providers });

    fireEvent.change(screen.getByPlaceholderText("Filter sites…"), {
      target: { value: "beta" },
    });
    expect(screen.queryByText("Alpha Site")).not.toBeInTheDocument();
    expect(screen.getByText("Beta Site")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(refetch).toHaveBeenCalled();

    const betaCard = screen.getByText("Beta Site").closest("div")?.parentElement?.parentElement;
    fireEvent.click(within(betaCard as HTMLElement).getByRole("button", { name: "Browse" }));
    expect(mockNavigate).toHaveBeenCalledWith("/sites/beta/explore");
  });

  it("creates a job and handles failures", async () => {
    const mutateAsync = jest.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new Error("failed"));
    mockUseCreateJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseSites.mockReturnValue({
      data: [{ short_name: "alpha", title: "Alpha Site", description: "First" }],
      isPending: false,
      isError: false,
      refetch: jest.fn(),
    });

    render(<SitesPage />, { wrapper: Providers });

    fireEvent.click(screen.getByRole("button", { name: "Extract All" }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      site_name: "alpha",
      selected_folder_node_ids: [],
    }));
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ color: "green" }));
    expect(mockNavigate).toHaveBeenCalledWith("/jobs");

    fireEvent.click(screen.getByRole("button", { name: "Extract All" }));
    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to create job",
      message: "failed",
      color: "red",
    })));
  });
});
