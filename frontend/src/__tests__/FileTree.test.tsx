jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      browse: {
        ...actual.api.browse,
        get: jest.fn(),
      },
    },
  };
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileTree } from "@/components/FileTree";
import { api, type BrowseResult } from "@/api/client";
import { Providers } from "./testUtils";

const mockedBrowseGet = api.browse.get as jest.MockedFunction<typeof api.browse.get>;

describe("FileTree", () => {
  const onToggle = jest.fn();
  const onBulkToggle = jest.fn();
  const onToggleFile = jest.fn();
  const onBulkToggleFiles = jest.fn();
  const onRegisterItems = jest.fn();
  const toLocaleStringSpy = jest
    .spyOn(Date.prototype, "toLocaleString")
    .mockReturnValue("tree date");

  afterAll(() => {
    toLocaleStringSpy.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const rootResult: BrowseResult = {
    site_name: "alpha",
    current_node_id: 0,
    folders: [{ node_id: 10, name: "Folder A", has_children: true }],
    files: [
      {
        node_id: 1,
        name: "root.pdf",
        mime_type: "application/pdf",
        modifier: "Ada",
        modified_at: "2024-01-01T00:00:00",
        size_bytes: 1024,
      },
    ],
  };

  function renderTree(selectedIds = new Set<number>(), selectedFileIds = new Set<number>()) {
    return render(
      <FileTree
        siteName="alpha"
        rootResult={rootResult}
        selectedIds={selectedIds}
        onToggle={onToggle}
        onBulkToggle={onBulkToggle}
        selectedFileIds={selectedFileIds}
        onToggleFile={onToggleFile}
        onBulkToggleFiles={onBulkToggleFiles}
        onRegisterItems={onRegisterItems}
      />,
      { wrapper: Providers },
    );
  }

  it("renders an empty placeholder when there are no folders or files", () => {
    render(
      <FileTree
        siteName="alpha"
        rootResult={{ site_name: "alpha", current_node_id: 0, folders: [], files: [] }}
        selectedIds={new Set()}
        onToggle={onToggle}
        onBulkToggle={onBulkToggle}
        selectedFileIds={new Set()}
        onToggleFile={onToggleFile}
        onBulkToggleFiles={onBulkToggleFiles}
      />,
      { wrapper: Providers },
    );

    expect(screen.getByText("This folder is empty.")).toBeInTheDocument();
  });

  it("registers root items and toggles root file selection", () => {
    renderTree();

    expect(onRegisterItems).toHaveBeenCalledWith(
      [10],
      [1],
      expect.any(Map),
      expect.any(Map),
      expect.any(Map),
    );
    expect(screen.getByText("root.pdf")).toBeInTheDocument();
    expect(screen.getByText("1 KB")).toBeInTheDocument();
    expect(screen.getByText("tree date")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggleFile).toHaveBeenCalledWith(1, true);
  });

  it("expands folders, registers lazy-loaded items, and cascades selection", async () => {
    mockedBrowseGet.mockResolvedValue({
      site_name: "alpha",
      current_node_id: 10,
      parent_node_id: 0,
      folders: [{ node_id: 20, name: "Child Folder", has_children: false }],
      files: [
        {
          node_id: 2,
          name: "child.txt",
          mime_type: "text/plain",
          modifier: "Bob",
          modified_at: "2024-01-02T00:00:00",
          size_bytes: 64,
        },
      ],
    });

    renderTree(new Set([10]));

    fireEvent.click(screen.getByLabelText("Expand"));

    await waitFor(() => expect(mockedBrowseGet).toHaveBeenCalledWith("alpha", 10));
    expect(await screen.findByText("child.txt")).toBeInTheDocument();
    expect(onRegisterItems).toHaveBeenLastCalledWith(
      [20],
      [2],
      expect.any(Map),
      expect.any(Map),
      expect.any(Map),
    );
    expect(onBulkToggle).toHaveBeenCalledWith([20], true);
    expect(onBulkToggleFiles).toHaveBeenCalledWith([2], true);

    fireEvent.click(screen.getByLabelText("Collapse"));
    fireEvent.click(screen.getByLabelText("Expand"));
    expect(onBulkToggle).toHaveBeenCalledWith([20], true);
    expect(onBulkToggleFiles).toHaveBeenCalledWith([2], true);

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onToggle).toHaveBeenCalledWith(10, false);
    expect(onBulkToggle).toHaveBeenCalledWith([20], false);
    expect(onBulkToggleFiles).toHaveBeenCalledWith([2], false);
  });

  it("shows an empty message for expanded empty folders", async () => {
    mockedBrowseGet.mockResolvedValue({
      site_name: "alpha",
      current_node_id: 10,
      folders: [],
      files: [],
    } as BrowseResult);

    renderTree();
    fireEvent.click(screen.getByLabelText("Expand"));

    expect(await screen.findAllByText("This folder is empty.")).toHaveLength(1);
  });

  it("handles lazy-load failures", async () => {
    mockedBrowseGet.mockRejectedValue(new Error("boom"));
    renderTree();

    fireEvent.click(screen.getByLabelText("Expand"));

    await waitFor(() => expect(mockedBrowseGet).toHaveBeenCalled());
    expect(screen.queryByText("child.txt")).not.toBeInTheDocument();
  });

  it("supports resizing and reordering columns", () => {
    const { container } = renderTree();

    const draggableHeaders = container.querySelectorAll("[draggable='true']");
    expect(draggableHeaders).toHaveLength(3);

    const sizeHeader = screen.getByText("Size").parentElement as HTMLElement;
    const modifierHeader = screen.getByText("Modified By").parentElement as HTMLElement;
    fireEvent.dragStart(modifierHeader, {
      dataTransfer: { effectAllowed: "", dropEffect: "", setData: jest.fn() },
    });
    fireEvent.dragOver(sizeHeader, {
      dataTransfer: { effectAllowed: "", dropEffect: "", setData: jest.fn() },
    });
    fireEvent.drop(sizeHeader, {
      dataTransfer: { effectAllowed: "", dropEffect: "", setData: jest.fn() },
    });

    const reordered = Array.from(container.querySelectorAll("[draggable='true']")).map(
      (node) => node.textContent,
    );
    expect(reordered[0]).toContain("Date Modified");
    expect(reordered[1]).toContain("Size");
    expect(reordered[2]).toContain("Modified By");

    const handles = Array.from(container.querySelectorAll("div")).filter((node) =>
      (node as HTMLDivElement).style.cursor === "col-resize",
    );
    fireEvent.mouseEnter(handles[0]);
    fireEvent.mouseDown(handles[0], { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    fireEvent.mouseUp(document);

    expect(document.body.style.cursor).toBe("");
    fireEvent.mouseLeave(handles[0]);
  });
});
