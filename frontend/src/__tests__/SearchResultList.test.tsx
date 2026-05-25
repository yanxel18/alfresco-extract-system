import { fireEvent, render, screen } from "@testing-library/react";
import { SearchResultList } from "@/components/SearchResultList";
import type { FileNodeBrief } from "@/api/client";
import { Providers } from "./testUtils";

describe("SearchResultList", () => {
  const toLocaleStringSpy = jest
    .spyOn(Date.prototype, "toLocaleString")
    .mockReturnValue("formatted date");

  afterAll(() => {
    toLocaleStringSpy.mockRestore();
  });

  const results: FileNodeBrief[] = [
    { node_id: 1, name: "image.png", mime_type: "image/png", modifier: "Ada", modified_at: "2024-01-01T00:00:00", size_bytes: 10 },
    { node_id: 2, name: "video.mp4", mime_type: "video/mp4", modifier: "Bob", modified_at: "2024-01-01T00:00:00", size_bytes: 20 },
    { node_id: 3, name: "audio.mp3", mime_type: "audio/mpeg", modifier: "Cid", modified_at: "2024-01-01T00:00:00", size_bytes: 30 },
    { node_id: 4, name: "sheet.csv", mime_type: "text/csv", modifier: "Dee", modified_at: "2024-01-01T00:00:00", size_bytes: 40 },
    { node_id: 5, name: "slides.ppt", mime_type: "application/powerpoint", modifier: "Eve", modified_at: "2024-01-01T00:00:00", size_bytes: 50 },
    { node_id: 6, name: "doc.pdf", mime_type: "application/pdf", modifier: "Flo", modified_at: "2024-01-01T00:00:00", size_bytes: 60 },
    { node_id: 7, name: "archive.zip", mime_type: "application/zip", modifier: undefined, modified_at: undefined, size_bytes: undefined },
    { node_id: 8, name: "fallback.bin", mime_type: undefined, modifier: "Gil", modified_at: "2024-01-01T00:00:00", size_bytes: 70 },
  ];

  it("renders loading skeletons", () => {
    const { container } = render(
      <SearchResultList
        results={[]}
        isLoading
        selectedFileIds={new Set()}
        onToggleFile={jest.fn()}
      />,
      { wrapper: Providers },
    );

    expect(container.querySelectorAll(".mantine-Skeleton-root")).toHaveLength(6);
  });

  it("renders an empty state", () => {
    render(
      <SearchResultList
        results={[]}
        selectedFileIds={new Set()}
        onToggleFile={jest.fn()}
      />,
      { wrapper: Providers },
    );

    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("renders search results and toggles selections", () => {
    const onToggleFile = jest.fn();
    render(
      <SearchResultList
        results={results}
        selectedFileIds={new Set([2])}
        onToggleFile={onToggleFile}
      />,
      { wrapper: Providers },
    );

    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Modified By")).toBeInTheDocument();
    expect(screen.getByText("Date Modified")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("image.png")).toBeInTheDocument();
    expect(screen.getByText("fallback.bin")).toBeInTheDocument();
    expect(screen.getAllByText("formatted date").length).toBeGreaterThan(1);
    expect(screen.getAllByText("—").length).toBeGreaterThan(1);
    expect(screen.getAllByRole("checkbox")).toHaveLength(results.length);

    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(onToggleFile).toHaveBeenCalledWith(2, false);
  });
});
