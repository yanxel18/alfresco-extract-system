const mockNavigate = jest.fn();
const mockUseBrowse = jest.fn();
const mockUseSearch = jest.fn();
const mockUseCreateJob = jest.fn();
const mockFolderSize = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
  useParams: () => ({ siteName: "alpha" }),
}));

jest.mock("@/hooks/useBrowse", () => ({
  useBrowse: (...args: unknown[]) => mockUseBrowse(...args),
  useSearch: (...args: unknown[]) => mockUseSearch(...args),
}));

jest.mock("@/hooks/useJobs", () => ({
  useCreateJob: () => mockUseCreateJob(),
}));

jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      browse: {
        ...actual.api.browse,
        folderSize: (...args: unknown[]) => mockFolderSize(...args),
      },
    },
  };
});

jest.mock("@/components/FileTree", () => ({
  FileTree: (props: any) => (
    <div>
      <button
        onClick={() =>
          props.onRegisterItems(
            [10, 11],
            [20, 21],
            new Map([
              [20, 100],
              [21, 30],
            ]),
            new Map([
              [20, 10],
              [21, 11],
            ]),
            new Map([[11, 10]]),
          )
        }
      >
        register-items
      </button>
      <button onClick={() => props.onToggle(10, true)}>toggle-folder</button>
      <button onClick={() => props.onToggle(10, false)}>toggle-folder-off</button>
      <button onClick={() => props.onBulkToggle([10, 11], true)}>bulk-folders</button>
      <button onClick={() => props.onBulkToggle([10, 11], false)}>bulk-folders-off</button>
      <button onClick={() => props.onBulkToggleFiles([20, 21], true)}>bulk-files</button>
      <button onClick={() => props.onBulkToggleFiles([20, 21], false)}>bulk-files-off</button>
      <button onClick={() => props.onToggleFile(20, true)}>toggle-file</button>
      <button onClick={() => props.onToggleFile(20, false)}>toggle-file-off</button>
      <div>mock-tree</div>
    </div>
  ),
}));

jest.mock("@/components/SearchResultList", () => ({
  SearchResultList: (props: any) => (
    <div>
      <button onClick={() => props.onToggleFile(99, true)}>toggle-search-file</button>
      <div>search-list:{props.results.length}:{String(props.isLoading)}</div>
    </div>
  ),
}));

jest.mock("@mantine/notifications", () => ({
  notifications: { show: jest.fn() },
}));

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { ExplorerPage } from "@/pages/ExplorerPage";
import { Providers } from "./testUtils";

const mockShow = notifications.show as jest.Mock;

describe("ExplorerPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFolderSize.mockResolvedValue([{ node_id: 10, total_size_bytes: 130 }]);
    mockUseCreateJob.mockReturnValue({ mutateAsync: jest.fn().mockResolvedValue({ id: 1 }), isPending: false });
    mockUseBrowse.mockReturnValue({
      data: { site_name: "alpha", current_node_id: 0, folders: [], files: [] },
      isPending: false,
      isError: false,
    });
    mockUseSearch.mockReturnValue({ data: [], isFetching: false });
  });

  it("renders loading and error states", () => {
    mockUseBrowse.mockReturnValue({ data: undefined, isPending: true, isError: false });
    const { rerender, container } = render(<ExplorerPage />, { wrapper: Providers });
    expect(container.querySelectorAll(".mantine-Skeleton-root")).toHaveLength(8);

    mockUseBrowse.mockReturnValue({ data: undefined, isPending: false, isError: true });
    rerender(<ExplorerPage />);
    expect(screen.getByText("An error occurred")).toBeInTheDocument();
  });

  it("tracks folder and file selections and starts extraction", async () => {
    const mutateAsync = jest.fn().mockResolvedValue({ id: 1 });
    mockUseCreateJob.mockReturnValue({ mutateAsync, isPending: false });
    render(<ExplorerPage />, { wrapper: Providers });

    fireEvent.click(screen.getByText("register-items"));
    fireEvent.click(screen.getByText("toggle-folder"));
    await waitFor(() => expect(mockFolderSize).toHaveBeenCalledWith("alpha", [10]));
    fireEvent.click(screen.getByText("toggle-file"));

    expect(screen.getByText(/1 folder selected/i)).toBeInTheDocument();
    expect(screen.getByText(/1 file selected/i)).toBeInTheDocument();
    expect(screen.getByText("130 B")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Extraction" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start Extraction" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      site_name: "alpha",
      selected_folder_node_ids: [10],
      selected_file_node_ids: [20],
      excluded_file_node_ids: [],
    }));
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ color: "green" }));
    expect(mockNavigate).toHaveBeenCalledWith("/jobs");

    fireEvent.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(screen.queryByText(/folder selected/i)).not.toBeInTheDocument();
  });

  it("supports select-all, bulk toggles, back navigation, and deselection", async () => {
    render(<ExplorerPage />, { wrapper: Providers });

    fireEvent.click(screen.getByText("register-items"));
    fireEvent.click(screen.getByRole("button", { name: "Select All" }));
    await waitFor(() => expect(mockFolderSize).toHaveBeenCalledWith("alpha", [10]));
    expect(screen.getByText(/2 folder selected/i)).toBeInTheDocument();
    expect(screen.getByText(/2 file selected/i)).toBeInTheDocument();
    expect(screen.getByText("130 B")).toBeInTheDocument();

    fireEvent.click(screen.getByText("bulk-folders-off"));
    fireEvent.click(screen.getByText("bulk-files-off"));
    fireEvent.click(screen.getByRole("button", { name: "Deselect All" }));
    expect(screen.queryByText(/folders selected/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "" })[0]);
    expect(mockNavigate).toHaveBeenCalledWith("/sites");
  });

  it("tracks exclusions when a selected folder has unchecked files", async () => {
    const mutateAsync = jest.fn().mockResolvedValue({ id: 2 });
    mockUseCreateJob.mockReturnValue({ mutateAsync, isPending: false });
    render(<ExplorerPage />, { wrapper: Providers });

    fireEvent.click(screen.getByText("register-items"));
    fireEvent.click(screen.getByText("toggle-folder"));
    await waitFor(() => expect(mockFolderSize).toHaveBeenCalledWith("alpha", [10]));
    fireEvent.click(screen.getByText("toggle-file-off"));

    expect(screen.getByText("30 B")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Extraction" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Only the 1 selected folder/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Start Extraction" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      site_name: "alpha",
      selected_folder_node_ids: [10],
      selected_file_node_ids: [],
      excluded_file_node_ids: [20],
    }));
  });

  it("supports search mode, clearing the query, and create-job failures", async () => {
    const mutateAsync = jest.fn().mockRejectedValue(new Error("bad create"));
    mockUseCreateJob.mockReturnValue({ mutateAsync, isPending: false });
    mockUseSearch.mockReturnValue({ data: [{ node_id: 99, name: "search.txt" }], isFetching: true });
    const { container } = render(<ExplorerPage />, { wrapper: Providers });

    const searchInput = screen.getByPlaceholderText("Search files by name…") as HTMLInputElement;
    fireEvent.change(searchInput, {
      target: { value: "report" },
    });
    expect(await screen.findByText("search-list:1:false")).toBeInTheDocument();

    fireEvent.click(screen.getByText("toggle-search-file"));
    fireEvent.click(screen.getByRole("button", { name: "Start Extraction" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start Extraction" }));

    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({
      title: "Failed to create job",
      message: "bad create",
      color: "red",
    })));

    const unnamedButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => !button.textContent,
    );
    fireEvent.click(unnamedButtons[1]);
    expect(searchInput.value).toBe("");
  });
});
