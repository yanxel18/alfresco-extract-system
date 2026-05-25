import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";

describe("AppLayout", () => {
  it("renders navigation, outlet content, theme toggle, and language selector", async () => {
    render(
      <MantineProvider>
        <MemoryRouter initialEntries={["/sites"]}>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/sites" element={<div>sites outlet</div>} />
              <Route path="/jobs" element={<div>jobs outlet</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </MantineProvider>,
    );

    expect(screen.getByText("Alfresco Extract")).toBeInTheDocument();
    expect(screen.getByText("sites outlet")).toBeInTheDocument();
    expect(screen.getByText("v2.0.0")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Jobs"));
    await waitFor(() => expect(screen.getByText("jobs outlet")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));

    fireEvent.mouseDown(screen.getByRole("textbox"));
    fireEvent.click(await screen.findByText("日本語"));
  });
});
