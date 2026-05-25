jest.mock("@/api/client", () => {
  const actual = jest.requireActual("@/api/client");
  return {
    ...actual,
    api: {
      ...actual.api,
      sites: { ...actual.api.sites, list: jest.fn() },
    },
  };
});

import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { api } from "@/api/client";
import { useSites } from "@/hooks/useSites";
import { createTestQueryClient, Providers } from "./testUtils";

const mockedList = api.sites.list as jest.MockedFunction<typeof api.sites.list>;

describe("useSites", () => {
  it("loads sites with react-query", async () => {
    mockedList.mockResolvedValue([{ short_name: "alpha", title: "Alpha" }]);
    const client = createTestQueryClient();

    const { result } = renderHook(() => useSites(), {
      wrapper: ({ children }) => React.createElement(Providers, { client }, children),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ short_name: "alpha", title: "Alpha" }]);
    expect(mockedList).toHaveBeenCalledTimes(1);
  });
});
