import { render, screen } from "@testing-library/react";
import {
  JobStatusBadge,
  FileStatusBadge,
  MigrationStatusBadge,
} from "@/components/StatusBadge";
import { Providers } from "./testUtils";

describe("StatusBadge", () => {
  it.each([
    "created",
    "scanning",
    "scanned",
    "copying",
    "done",
    "paused",
    "failed",
    "migrating",
    "migrated",
  ] as const)("renders job status %s", (status) => {
    render(<JobStatusBadge status={status} />, { wrapper: Providers });
    expect(screen.getByText(new RegExp(status, "i"))).toBeInTheDocument();
  });

  it.each([
    ["pending", false, /pending/i],
    ["copied", false, /copied/i],
    ["failed", false, /failed/i],
    ["skipped", false, /skipped/i],
    ["pending", true, /copying/i],
  ] as const)("renders file status %s (active=%s)", (status, active, matcher) => {
    render(<FileStatusBadge status={status} active={active} />, { wrapper: Providers });
    expect(screen.getByText(matcher)).toBeInTheDocument();
  });

  it.each([
    ["pending", false, /pending/i],
    ["migrated", false, /migrated/i],
    ["failed", false, /failed/i],
    ["skipped", false, /skipped/i],
    ["pending", true, /queued/i],
  ] as const)(
    "renders migration status %s (active=%s)",
    (status, active, matcher) => {
      render(<MigrationStatusBadge status={status} active={active} />, {
        wrapper: Providers,
      });
      expect(screen.getByText(matcher)).toBeInTheDocument();
    },
  );
});
