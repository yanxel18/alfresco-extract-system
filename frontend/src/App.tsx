import {
  MantineProvider,
  ColorSchemeScript,
  localStorageColorSchemeManager,
} from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createBrowserRouter,
  RouterProvider,
  Navigate,
} from "react-router-dom";
import { theme } from "./theme";
import { AppLayout } from "./components/AppLayout";
import { SitesPage } from "./pages/SitesPage";
import { ExplorerPage } from "./pages/ExplorerPage";
import { JobsPage } from "./pages/JobsPage";
import { JobDetailPage } from "./pages/JobDetailPage";

const colorSchemeManager = localStorageColorSchemeManager({
  key: "aes-color-scheme",
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/sites" replace /> },
      { path: "sites", element: <SitesPage /> },
      { path: "sites/:siteName/explore", element: <ExplorerPage /> },
      { path: "jobs", element: <JobsPage /> },
      { path: "jobs/:jobId", element: <JobDetailPage /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} colorSchemeManager={colorSchemeManager}>
        <ColorSchemeScript localStorageKey="aes-color-scheme" />
        <RouterProvider router={router} />
      </MantineProvider>
    </QueryClientProvider>
  );
}
