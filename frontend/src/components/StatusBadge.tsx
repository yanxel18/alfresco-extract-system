import { Badge, Group, Loader } from "@mantine/core";
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
  /** Pass true when the parent job is actively copying so pending rows show a spinner */
  active?: boolean;
}

export function FileStatusBadge({ status, active }: FileStatusBadgeProps) {
  const { t } = useTranslation();
  if (active && status === "pending") {
    return (
      <Group gap={4} wrap="nowrap">
        <Loader size={12} color="violet" />
        <Badge color="violet" variant="light" size="sm">
          {t("status.copying", "Copying…")}
        </Badge>
      </Group>
    );
  }
  return (
    <Badge color={FILE_COLORS[status]} variant="light" size="sm">
      {t(`status.${status}`)}
    </Badge>
  );
}

interface MigrationStatusBadgeProps {
  status: MigrationStatus;
  /** Pass true when the parent job is actively migrating so pending rows show a spinner */
  active?: boolean;
}

export function MigrationStatusBadge({ status, active }: MigrationStatusBadgeProps) {
  const { t } = useTranslation();
  if (active && status === "pending") {
    return (
      <Group gap={4} wrap="nowrap">
        <Loader size={12} color="indigo" />
        <Badge color="indigo" variant="light" size="sm">
          {t("migrationStatus.queued", "Queued…")}
        </Badge>
      </Group>
    );
  }
  return (
    <Badge color={MIGRATION_COLORS[status]} variant="light" size="sm">
      {t(`migrationStatus.${status}`, status)}
    </Badge>
  );
}

