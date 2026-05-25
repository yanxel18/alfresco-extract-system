import type { PropsWithChildren, ReactElement } from "react";
import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function Providers({
  children,
  client = createTestQueryClient(),
}: PropsWithChildren<{ client?: QueryClient }>) {
  return (
    <QueryClientProvider client={client}>
      <MantineProvider>{children}</MantineProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactElement, client = createTestQueryClient()) {
  return {
    client,
    ...render(ui, {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
    }),
  };
}
