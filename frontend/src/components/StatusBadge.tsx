import { Badge } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { JobStatus, FileStatus, MigrationStatus } from "@/api/client";

const JOB_COLORS: Record<JobStatus, string> = {
  created: "gray",
  scanning: "blue",
  scanned: "cyan",
  copying: "violet",
  done: "green",
  paused: "orange",
  failed: "red",
  migrating: "indigo",
  migrated: "teal",
};

const FILE_COLORS: Record<FileStatus, string> = {
  pending: "gray",
  copied: "green",
  failed: "red",
  skipped: "yellow",
};

const MIGRATION_COLORS: Record<MigrationStatus, string> = {
  pending: "gray",
  migrated: "teal",
  failed: "red",
  skipped: "yellow",
};

interface JobStatusBadgeProps {
  status: JobStatus;
}

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge color={JOB_COLORS[status] ?? "gray"} variant="light">
      {t(`status.${status}`, status)}
    </Badge>
  );
}

interface FileStatusBadgeProps {
  status: FileStatus;
}

export function FileStatusBadge({ status }: FileStatusBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge color={FILE_COLORS[status]} variant="light" size="sm">
      {t(`status.${status}`)}
    </Badge>
  );
}

interface MigrationStatusBadgeProps {
  status: MigrationStatus;
}

export function MigrationStatusBadge({ status }: MigrationStatusBadgeProps) {
  const { t } = useTranslation();
  return (
    <Badge color={MIGRATION_COLORS[status]} variant="light" size="sm">
      {t(`migrationStatus.${status}`, status)}
    </Badge>
  );
}
