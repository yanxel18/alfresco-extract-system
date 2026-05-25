import { useState, useEffect, useRef } from "react";
import {
  Stack,
  Group,
  Text,
  Button,
  Paper,
  Progress,
  Alert,
  ActionIcon,
  Tooltip,
  Table,
  Pagination,
  Divider,
  Grid,
  Card,
  ThemeIcon,
  Modal,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Database,
  Download,
  Pause,
  RotateCcw,
  Trash2,
  Clock,
  CheckCircle,
  XCircle,
  Minus,
} from "lucide-react";
import { useMigration } from "@/hooks/useJobs";
import { MigrationStatusBadge } from "@/components/StatusBadge";
import { formatDate, formatDuration, utcMs } from "@/utils";
import { api } from "@/api/client";
import { notifications } from "@mantine/notifications";
import type { Job } from "@/api/client";

const PAGE_SIZE = 100;

interface MigrationTabProps {
  jobId: number;
  job: Job | undefined;
  migrationActions: {
    start: { isPending: boolean; mutateAsync: () => Promise<unknown> };
    pause: { isPending: boolean; mutateAsync: () => Promise<unknown> };
    resume: { isPending: boolean; mutateAsync: () => Promise<unknown> };
    revert: { isPending: boolean; mutateAsync: () => Promise<unknown> };
  };
}

/** Migration tab: stats grid, progress bar, elapsed/speed/ETA, and records table. */
export function MigrationTab({
  jobId,
  job,
  migrationActions,
}: MigrationTabProps) {
  const { t } = useTranslation();
  const [migrationPage, setMigrationPage] = useState(1);
  const [migrationSpeed, setMigrationSpeed] = useState(0);
  const [migrationElapsedSec, setMigrationElapsedSec] = useState(0);
  const [revertOpened, { open: openRevert, close: closeRevert }] =
    useDisclosure();

  const isJobMigrating = job?.status === "migrating";

  const { data: migration, refetch: refetchMigration } = useMigration(
    jobId,
    job?.status,
    migrationPage,
    PAGE_SIZE,
  );

  // Migration speed tracking (files/sec)
  const prevMigrationSnapshotRef = useRef<{
    count: number;
    time: number;
  } | null>(null);

  useEffect(() => {
    if (!migration || !isJobMigrating) {
      prevMigrationSnapshotRef.current = null;
      return;
    }
    const now = Date.now();
    if (prevMigrationSnapshotRef.current) {
      const deltaSec = (now - prevMigrationSnapshotRef.current.time) / 1000;
      const deltaFiles =
        migration.migrated - prevMigrationSnapshotRef.current.count;
      if (deltaSec > 0 && deltaFiles > 0) {
        setMigrationSpeed(deltaFiles / deltaSec);
      }
    }
    prevMigrationSnapshotRef.current = { count: migration.migrated, time: now };
  }, [migration?.migrated, isJobMigrating]);

  useEffect(() => {
    if (!isJobMigrating || !migration?.migration_started_at) return;
    const startMs = utcMs(migration.migration_started_at);
    setMigrationElapsedSec(Math.floor((Date.now() - startMs) / 1000));
    const timerId = setInterval(() => {
      setMigrationElapsedSec(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(timerId);
  }, [isJobMigrating, migration?.migration_started_at]);

  const migrationEtaSec =
    isJobMigrating && migrationSpeed > 0 && migration
      ? migration.pending / migrationSpeed
      : null;

  const finalMigrationElapsedSec =
    migration?.migration_started_at &&
    (job?.status === "migrated" ||
      job?.status === "failed" ||
      job?.status === "paused")
      ? Math.floor(
          (utcMs(job!.updated_at) - utcMs(migration.migration_started_at)) /
            1000,
        )
      : null;

  const migrationTotalPages = migration
    ? Math.ceil(migration.total_records / PAGE_SIZE)
    : 1;

  const handleStartMigration = async () => {
    try {
      await migrationActions.start.mutateAsync();
      notifications.show({
        message: t("migration.startMigration"),
        color: "indigo",
      });
    } catch {
      notifications.show({
        message: t("notifications.errorAction"),
        color: "red",
      });
    }
  };

  const handlePauseMigration = async () => {
    try {
      await migrationActions.pause.mutateAsync();
      notifications.show({
        message: t("migration.pauseMigration"),
        color: "orange",
      });
    } catch {
      notifications.show({
        message: t("notifications.errorAction"),
        color: "red",
      });
    }
  };

  const handleResumeMigration = async () => {
    try {
      await migrationActions.resume.mutateAsync();
      notifications.show({
        message: t("migration.resumeMigration"),
        color: "indigo",
      });
    } catch {
      notifications.show({
        message: t("notifications.errorAction"),
        color: "red",
      });
    }
  };

  const handleRevertMigration = async () => {
    closeRevert();
    try {
      await migrationActions.revert.mutateAsync();
      notifications.show({
        message: t("migration.revertSuccess"),
        color: "red",
      });
    } catch {
      notifications.show({
        message: t("notifications.errorAction"),
        color: "red",
      });
    }
  };

  return (
    <Stack gap="md">
      {/* Revert confirmation modal */}
      <Modal
        opened={revertOpened}
        onClose={closeRevert}
        title={t("migration.revertConfirmTitle", { id: jobId })}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">{t("migration.revertConfirmMsg")}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={closeRevert}>
              {t("common.cancel")}
            </Button>
            <Button
              color="red"
              leftSection={<Trash2 size={14} />}
              loading={migrationActions.revert.isPending}
              onClick={handleRevertMigration}
            >
              {t("migration.revertMigration")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Controls */}
      <Group gap="xs">
        {(job?.status === "done" ||
          job?.status === "migrated" ||
          job?.status === "failed") && (
          <Button
            size="sm"
            color="indigo"
            leftSection={<Database size={14} />}
            loading={migrationActions.start.isPending}
            onClick={handleStartMigration}
          >
            {t("migration.startMigration")}
          </Button>
        )}
        {job?.status === "migrating" && (
          <Button
            size="sm"
            color="orange"
            variant="light"
            leftSection={<Pause size={14} />}
            loading={migrationActions.pause.isPending}
            onClick={handlePauseMigration}
          >
            {t("migration.pauseMigration")}
          </Button>
        )}
        {job?.status === "paused" && migration && migration.total > 0 && (
          <Button
            size="sm"
            color="indigo"
            variant="light"
            leftSection={<RotateCcw size={14} />}
            loading={migrationActions.resume.isPending}
            onClick={handleResumeMigration}
          >
            {t("migration.resumeMigration")}
          </Button>
        )}
        {migration && migration.migrated > 0 && (
          <Button
            size="sm"
            variant="default"
            leftSection={<Download size={14} />}
            component="a"
            href={api.migration.sqlUrl(jobId)}
            download
          >
            {t("migration.downloadSql")}
          </Button>
        )}
        {migration &&
          migration.migrated > 0 &&
          job?.status !== "migrating" && (
            <Button
              size="sm"
              color="red"
              variant="light"
              leftSection={<Trash2 size={14} />}
              loading={migrationActions.revert.isPending}
              onClick={openRevert}
            >
              {t("migration.revertMigration")}
            </Button>
          )}
        <Tooltip label={t("common.retry")}>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => refetchMigration()}
          >
            <RefreshCw size={14} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Not started hint */}
      {(!migration || migration.total === 0) &&
        job?.status !== "migrating" && (
          <Alert icon={<Database size={16} />} color="gray">
            <Text size="sm">{t("migration.notStarted")}</Text>
            {job?.status !== "done" && job?.status !== "migrated" && (
              <Text size="xs" c="dimmed" mt={4}>
                {t("migration.notStartedHint")}
              </Text>
            )}
          </Alert>
        )}

      {/* Progress stats */}
      {migration && migration.total > 0 && (
        <>
          <Grid>
            {[
              {
                label: t("migration.inRun"),
                value: migration.total,
                sub: t("migration.inRunHint"),
                color: "gray",
                icon: <Minus size={18} />,
              },
              {
                label: t("migration.migrated"),
                value: migration.migrated,
                sub: null,
                color: "teal",
                icon: <CheckCircle size={18} />,
              },
              {
                label: t("migration.failed"),
                value: migration.failed,
                sub: null,
                color: migration.failed > 0 ? "red" : "gray",
                icon: <XCircle size={18} />,
              },
              {
                label: t("migration.pending"),
                value: migration.pending,
                sub: t("migration.pendingHint"),
                color: "blue",
                icon: <Clock size={18} />,
              },
              {
                label: t("migration.skipped"),
                value: migration.skipped,
                sub: null,
                color: "yellow",
                icon: <Minus size={18} />,
              },
            ].map((s) => (
              <Grid.Col key={s.label} span={{ base: 6, sm: 4, md: 2 }}>
                <Card withBorder>
                  <Group gap="xs" mb="xs">
                    <ThemeIcon size="sm" variant="light" color={s.color}>
                      {s.icon}
                    </ThemeIcon>
                    <Text size="xs" c="dimmed">
                      {s.label}
                    </Text>
                  </Group>
                  <Text size="xl" fw={700}>
                    {s.value.toLocaleString()}
                  </Text>
                  {s.sub && (
                    <Text size="xs" c="dimmed" mt={2}>
                      {s.sub}
                    </Text>
                  )}
                </Card>
              </Grid.Col>
            ))}
          </Grid>

          <Progress
            value={
              migration.total > 0
                ? Math.round(
                    ((migration.migrated + migration.skipped) /
                      migration.total) *
                      100,
                  )
                : 0
            }
            color="teal"
            animated={job?.status === "migrating"}
            size="md"
          />

          {/* Migration elapsed / speed / ETA strip */}
          {migration.migration_started_at && (
            <>
              <Divider my="xs" />
              <Group gap="xl" wrap="nowrap">
                <Stack gap={2} align="center" style={{ flex: 1 }}>
                  <Text size="xs" c="dimmed">
                    {finalMigrationElapsedSec !== null
                      ? t("jobDetail.totalTime")
                      : t("jobDetail.elapsed")}
                  </Text>
                  <Text size="sm" fw={600}>
                    {formatDuration(
                      finalMigrationElapsedSec !== null
                        ? finalMigrationElapsedSec
                        : migrationElapsedSec,
                    )}
                  </Text>
                </Stack>
                {isJobMigrating && (
                  <>
                    <Stack gap={2} align="center" style={{ flex: 1 }}>
                      <Text size="xs" c="dimmed">
                        {t("jobDetail.speed")}
                      </Text>
                      <Text size="sm" fw={600}>
                        {migrationSpeed > 0
                          ? `${migrationSpeed.toFixed(2)} files/s`
                          : t("jobDetail.calculating")}
                      </Text>
                    </Stack>
                    <Stack gap={2} align="center" style={{ flex: 1 }}>
                      <Text size="xs" c="dimmed">
                        {t("jobDetail.eta")}
                      </Text>
                      <Text size="sm" fw={600}>
                        {migrationEtaSec !== null
                          ? formatDuration(migrationEtaSec)
                          : t("jobDetail.calculating")}
                      </Text>
                    </Stack>
                  </>
                )}
              </Group>
            </>
          )}
        </>
      )}

      {/* Migration records table */}
      {migration && migration.records.length > 0 && (
        <Paper withBorder style={{ overflow: "auto" }}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("migration.originalName")}</Table.Th>
                <Table.Th>{t("migration.originalPath")}</Table.Th>
                <Table.Th>{t("migration.uuidFilename")}</Table.Th>
                <Table.Th>{t("jobDetail.status")}</Table.Th>
                <Table.Th>{t("migration.duration")}</Table.Th>
                <Table.Th>{t("migration.targetFolderId")}</Table.Th>
                <Table.Th>{t("migration.targetFileId")}</Table.Th>
                <Table.Th>{t("migration.migratedAt")}</Table.Th>
                <Table.Th>{t("migration.error")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {migration.records.map((rec) => (
                <Table.Tr key={rec.id}>
                  <Table.Td>
                    <Text
                      size="xs"
                      truncate
                      maw={180}
                      title={rec.original_name ?? ""}
                    >
                      {rec.original_name ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      c="dimmed"
                      truncate
                      maw={220}
                      title={rec.original_path ?? ""}
                    >
                      {rec.original_path ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" truncate maw={180}>
                      {rec.uuid_filename ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <MigrationStatusBadge
                      status={rec.status}
                      active={isJobMigrating}
                    />
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {rec.duration_ms != null
                        ? rec.duration_ms >= 1000
                          ? `${(rec.duration_ms / 1000).toFixed(1)}s`
                          : `${rec.duration_ms}ms`
                        : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" truncate maw={200}>
                      {rec.target_folder_id ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" truncate maw={200}>
                      {rec.target_file_id ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {rec.migrated_at ? formatDate(rec.migrated_at) : "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {rec.error_msg ? (
                      <Tooltip
                        label={rec.error_msg}
                        openDelay={300}
                        withArrow
                        multiline
                        maw={300}
                      >
                        <Text size="xs" c="red" truncate maw={160}>
                          {rec.error_msg}
                        </Text>
                      </Tooltip>
                    ) : (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      {migration &&
        migration.records.length === 0 &&
        migration.total_records === 0 && (
          <Alert icon={<Clock size={16} />} color="gray">
            {t("migration.noRecords")}
          </Alert>
        )}

      {migrationTotalPages > 1 && (
        <Group justify="center" mt="sm">
          <Pagination
            total={migrationTotalPages}
            value={migrationPage}
            onChange={setMigrationPage}
            size="sm"
          />
        </Group>
      )}
    </Stack>
  );
}
