jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      browse: {
        ...actual.api.browse,
        get: jest.fn(),
        search: jest.fn(),
      },
    },
  };
});

import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/api/client";
import { useBrowse, useSearch } from "@/hooks/useBrowse";
import { createTestQueryClient, Providers } from "./testUtils";

const mockedGet = api.browse.get as jest.MockedFunction<typeof api.browse.get>;
const mockedSearch = api.browse.search as jest.MockedFunction<typeof api.browse.search>;

describe("useBrowse hooks", () => {
  it("loads browse results when a site is present", async () => {
    mockedGet.mockResolvedValue({
      site_name: "alpha",
      current_node_id: 0,
      folders: [],
      files: [],
    });
    const client = createTestQueryClient();

    const { result } = renderHook(() => useBrowse("alpha", 1), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedGet).toHaveBeenCalledWith("alpha", 1);
  });

  it("does not browse without a site name", async () => {
    const client = createTestQueryClient();

    const { result } = renderHook(() => useBrowse(""), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(mockedGet).not.toHaveBeenCalled();
  });

  it("only searches when the query is long enough", async () => {
    mockedSearch.mockResolvedValue([]);
    const enabledClient = createTestQueryClient();
    const disabledClient = createTestQueryClient();

    const enabled = renderHook(() => useSearch("alpha", "report"), {
      wrapper: ({ children }) => React.createElement(Providers, { client: enabledClient }, children),
    });
    const disabled = renderHook(() => useSearch("alpha", " a "), {
      wrapper: ({ children }) => React.createElement(Providers, { client: disabledClient }, children),
    });

    await waitFor(() => expect(enabled.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(disabled.result.current.fetchStatus).toBe("idle"));

    expect(mockedSearch).toHaveBeenCalledWith("alpha", "report");
    expect(disabled.result.current.data).toBeUndefined();
  });
});
