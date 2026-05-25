jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  createBrowserRouter: jest.fn((routes) => ({ routes })),
  RouterProvider: () => <div>router provider</div>,
}));

import { render, screen } from "@testing-library/react";
import { App } from "@/App";

describe("App", () => {
  it("renders the router provider inside the app providers", () => {
    render(<App />);

    expect(screen.getByText("router provider")).toBeInTheDocument();
  });
});
