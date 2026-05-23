import { useState, useEffect, useRef } from "react";
import {
  Stack,
  Title,
  Group,
  Text,
  Button,
  Paper,
  Badge,
  Progress,
  Alert,
  ActionIcon,
  Tooltip,
  Table,
  Skeleton,
  Select,
  Pagination,
  Grid,
  Card,
  ThemeIcon,
  Modal,
  Divider,
  Tabs,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  RefreshCw,
  FileText,
  AlertCircle,
  CheckCircle,
  XCircle,
  Clock,
  Minus,
  Play,
  Pause,
  RotateCcw,
  Trash2,
  Database,
} from "lucide-react";
import {
  useJob,
  useJobFiles,
  useJobAction,
  useDeleteJob,
  useMigration,
  useMigrationActions,
} from "@/hooks/useJobs";
import {
  JobStatusBadge,
  FileStatusBadge,
  MigrationStatusBadge,
} from "@/components/StatusBadge";
import { formatBytes, formatDate } from "@/utils";
import { notifications } from "@mantine/notifications";
import type { FileStatus, FileRecord } from "@/api/client";
import { api } from "@/api/client";

const PAGE_SIZE = 100;

function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0 || !isFinite(bytesPerSec)) return "—";
  if (bytesPerSec >= 1024 * 1024 * 1024)
    return `${(bytesPerSec / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
  if (bytesPerSec >= 1024 * 1024)
    return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

function fileProgressProps(file: FileRecord, isJobCopying: boolean) {
  switch (file.status) {
    case "copied":
      return { value: 100, color: "green", animated: false };
    case "failed":
      return { value: 100, color: "red", animated: false };
    case "skipped":
      return { value: 100, color: "gray", animated: false };
    default:
      return {
        value: isJobCopying ? 15 : 0,
        color: "cyan",
        animated: isJobCopying,
      };
  }
}

export function JobDetailPage() {
  const { t } = useTranslation();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [migrationPage, setMigrationPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<FileStatus | "">("");
  const [migrationSpeed, setMigrationSpeed] = useState(0); // files/sec
  const [migrationElapsedSec, setMigrationElapsedSec] = useState(0);
  const [deleteOpened, { open: openDelete, close: closeDelete }] =
    useDisclosure();
  const [revertOpened, { open: openRevert, close: closeRevert }] =
    useDisclosure();

  const id = Number(jobId);
  const {
    data: job,
    isPending: jobLoading,
    isError,
    refetch: refetchJob,
  } = useJob(id);
  const {
    data: filesData,
    isPending: filesLoading,
    refetch: refetchFiles,
  } = useJobFiles(id, page, PAGE_SIZE, statusFilter || undefined, job?.status);

  const actions = useJobAction(id);
  const deleteJob = useDeleteJob();
  const { data: migration, refetch: refetchMigration } = useMigration(
    id,
    job?.status,
    migrationPage,
    PAGE_SIZE,
  );
  const migrationActions = useMigrationActions(id);

  const isJobActive =
    job?.status === "copying" ||
    job?.status === "scanning" ||
    job?.status === "migrating";
  const isJobCopying = job?.status === "copying";

  // Speed / ETA / elapsed tracking
  const prevSnapshotRef = useRef<{ bytes: number; time: number } | null>(null);
  const prevMigrationSnapshotRef = useRef<{ count: number; time: number } | null>(null);
  const [copySpeed, setCopySpeed] = useState<number>(0); // bytes/sec
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  // Recompute speed whenever copied_size_bytes changes (on each poll)
  useEffect(() => {
    if (!job || job.status !== "copying") {
      prevSnapshotRef.current = null;
      return;
    }
    const now = Date.now();
    if (prevSnapshotRef.current) {
      const deltaSec = (now - prevSnapshotRef.current.time) / 1000;
      const deltaBytes = job.copied_size_bytes - prevSnapshotRef.current.bytes;
      if (deltaSec > 0 && deltaBytes > 0) {
        setCopySpeed(deltaBytes / deltaSec);
      }
    }
    prevSnapshotRef.current = { bytes: job.copied_size_bytes, time: now };
  }, [job?.copied_size_bytes, job?.status]);

  // Tick elapsed every second using server's copy_started_at — native setInterval auto-starts
  useEffect(() => {
    if (!isJobCopying || !job?.copy_started_at) return;
    const startMs = new Date(job.copy_started_at).getTime();
    // Set immediately so there's no 0s flash
    setElapsedSec(Math.floor((Date.now() - startMs) / 1000));
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isJobCopying, job?.copy_started_at]);

  // When job finishes, compute final elapsed from DB timestamps
  const finalElapsedSec =
    job?.copy_started_at &&
    (job.status === "done" ||
      job.status === "failed" ||
      job.status === "paused")
      ? Math.floor(
          (new Date(job.updated_at).getTime() -
            new Date(job.copy_started_at).getTime()) /
            1000,
        )
      : null;

  const remainingBytes =
    (job?.total_size_bytes ?? 0) - (job?.copied_size_bytes ?? 0);
  const etaSec =
    isJobCopying && copySpeed > 0 ? remainingBytes / copySpeed : null;

  // Migration speed/ETA tracking (files/sec)
  const isJobMigrating = job?.status === "migrating";

  useEffect(() => {
    if (!migration || !isJobMigrating) {
      prevMigrationSnapshotRef.current = null;
      return;
    }
    const now = Date.now();
    if (prevMigrationSnapshotRef.current) {
      const deltaSec = (now - prevMigrationSnapshotRef.current.time) / 1000;
      const deltaFiles = migration.migrated - prevMigrationSnapshotRef.current.count;
      if (deltaSec > 0 && deltaFiles > 0) {
        setMigrationSpeed(deltaFiles / deltaSec);
      }
    }
    prevMigrationSnapshotRef.current = { count: migration.migrated, time: now };
  }, [migration?.migrated, isJobMigrating]);

  // Tick migration elapsed every second
  useEffect(() => {
    if (!isJobMigrating || !migration?.migration_started_at) return;
    const startMs = new Date(migration.migration_started_at).getTime();
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
    (job?.status === "migrated" || job?.status === "failed" || job?.status === "paused")
      ? Math.floor(
          (new Date(job!.updated_at).getTime() -
            new Date(migration.migration_started_at).getTime()) /
            1000,
        )
      : null;

  const copyProgress =
    job && job.total_files > 0
      ? Math.round((job.copied_files / job.total_files) * 100)
      : 0;

  const scanProgress =
    job && job.total_files > 0
      ? Math.round((job.scanned_files / job.total_files) * 100)
      : 0;

  const totalPages = filesData ? Math.ceil(filesData.total / PAGE_SIZE) : 1;
  const migrationTotalPages = migration
    ? Math.ceil(migration.total_records / PAGE_SIZE)
    : 1;

  const handleStartCopy = async () => {
    try {
      await actions.startCopy.mutateAsync();
      notifications.show({
        message: t("notifications.jobStartCopy", { id }),
        color: "violet",
      });
    } catch {
      notifications.show({
        message: t("notifications.errorAction"),
        color: "red",
      });
    }
  };

  const handlePause = async () => {
    try {
      await actions.pause.mutateAsync();
      notifications.show({
        message: t("notifications.jobPaused", { id }),
        color: "orange",
      });
    } catch {
      notifications.show({
        message: t("notifications.errorAction"),
        color: "red",
      });
    }
  };

  const handleResume = async () => {
    try {
      await actions.resume.mutateAsync();
      notifications.show({
        message: t("notifications.jobResumed", { id }),
        color: "cyan",
      });
    } catch {
      notifications.show({
        message: t("notifications.errorAction"),
        color: "red",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteJob.mutateAsync(id);
      notifications.show({
        message: t("notifications.jobDeleted", { id }),
        color: "red",
      });
      navigate("/jobs");
    } catch {
      notifications.show({
        message: t("notifications.errorDeleting"),
        color: "red",
      });
    }
  };

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

  if (isError) {
    return (
      <Alert icon={<AlertCircle size={16} />} color="red" mt="xl">
        {t("common.error")}
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      {/* Delete confirmation modal */}
      <Modal
        opened={deleteOpened}
        onClose={closeDelete}
        title={t("jobs.deleteConfirmTitle", { id })}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">{t("jobs.deleteConfirmMsg")}</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="default" onClick={closeDelete}>
              {t("common.cancel")}
            </Button>
            <Button
              color="red"
              leftSection={<Trash2 size={14} />}
              loading={deleteJob.isPending}
              onClick={handleDelete}
            >
              {t("jobs.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Revert migration confirmation modal */}
      <Modal
        opened={revertOpened}
        onClose={closeRevert}
        title={t("migration.revertConfirmTitle", { id })}
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

      {/* Header */}
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm">
          <ActionIcon variant="subtle" onClick={() => navigate("/jobs")}>
            <ArrowLeft size={18} />
          </ActionIcon>
          <div>
            <Title order={2}>
              {jobLoading ? (
                <Skeleton w={200} h={24} />
              ) : (
                `${t("jobDetail.title")} #${id}`
              )}
            </Title>
            {job && (
              <Group gap="xs" mt={4}>
                <JobStatusBadge status={job.status} />
                <Text size="sm" c="dimmed">
                  {job.site_name}
                </Text>
              </Group>
            )}
          </div>
        </Group>

        {/* Action buttons */}
        <Group gap="xs">
          {/* Start Copy — only when scanned */}
          {job?.status === "scanned" && (
            <Button
              size="sm"
              color="violet"
              leftSection={<Play size={14} />}
              loading={actions.startCopy.isPending}
              onClick={handleStartCopy}
            >
              {t("jobs.startCopy")}
            </Button>
          )}

          {/* Pause — when actively running */}
          {(job?.status === "copying" || job?.status === "scanning") && (
            <Button
              size="sm"
              color="orange"
              variant="light"
              leftSection={<Pause size={14} />}
              loading={actions.pause.isPending}
              onClick={handlePause}
            >
              {t("jobs.pause")}
            </Button>
          )}

          {/* Resume — when paused or failed */}
          {(job?.status === "paused" || job?.status === "failed") && (
            <Button
              size="sm"
              color="cyan"
              variant="light"
              leftSection={<RotateCcw size={14} />}
              loading={actions.resume.isPending}
              onClick={handleResume}
            >
              {t("jobs.resume")}
            </Button>
          )}

          {job && (
            <Tooltip label={t("jobs.downloadCsv")}>
              <Button
                size="sm"
                variant="default"
                leftSection={<Download size={14} />}
                component="a"
                href={`/api/jobs/${job.id}/csv`}
                download
                disabled={job.status === "scanning" || job.status === "created"}
              >
                {t("jobs.downloadCsv")}
              </Button>
            </Tooltip>
          )}

          {job && (
            <Tooltip label={t("jobs.delete")}>
              <Button
                size="sm"
                color="red"
                variant="subtle"
                leftSection={<Trash2 size={14} />}
                disabled={isJobActive}
                onClick={openDelete}
              >
                {t("jobs.delete")}
              </Button>
            </Tooltip>
          )}
        </Group>
      </Group>

      {/* Stats grid */}
      {jobLoading && <Skeleton height={120} radius="md" />}
      {job && (
        <Grid>
          {[
            {
              label: t("jobs.scanned"),
              value: job.scanned_files.toLocaleString(),
              icon: <FileText size={20} />,
              color: "blue",
            },
            {
              label: t("jobs.copied"),
              value: job.copied_files.toLocaleString(),
              icon: <CheckCircle size={20} />,
              color: "green",
            },
            {
              label: t("jobs.failed"),
              value: job.failed_files.toLocaleString(),
              icon: <XCircle size={20} />,
              color: job.failed_files > 0 ? "red" : "gray",
            },
            {
              label: t("jobs.total"),
              value: job.total_files.toLocaleString(),
              icon: <Minus size={20} />,
              color: "gray",
            },
            {
              label: t("jobDetail.totalSize"),
              value: formatBytes(job.total_size_bytes),
              icon: <Minus size={20} />,
              color: "indigo",
            },
            {
              label: t("jobDetail.copiedSize"),
              value: formatBytes(job.copied_size_bytes),
              icon: <CheckCircle size={20} />,
              color: "teal",
            },
          ].map((stat) => (
            <Grid.Col key={stat.label} span={{ base: 6, sm: 4, md: 2 }}>
              <Card withBorder>
                <Group gap="xs" mb="xs">
                  <ThemeIcon size="sm" variant="light" color={stat.color}>
                    {stat.icon}
                  </ThemeIcon>
                  <Text size="xs" c="dimmed">
                    {stat.label}
                  </Text>
                </Group>
                <Text size="xl" fw={700}>
                  {stat.value}
                </Text>
              </Card>
            </Grid.Col>
          ))}
        </Grid>
      )}

      {/* Progress bars */}
      {job && (
        <Paper withBorder p="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm">{t("jobDetail.scanProgress")}</Text>
              <Text size="sm" fw={500}>
                {scanProgress}%
              </Text>
            </Group>
            <Progress
              value={scanProgress}
              color="cyan"
              animated={job.status === "scanning"}
              size="md"
            />
            <Group justify="space-between" mt="xs">
              <Text size="sm">{t("jobDetail.copyProgress")}</Text>
              <Text size="sm" fw={500}>
                {copyProgress}%
              </Text>
            </Group>
            <Progress
              value={copyProgress}
              color="green"
              animated={job.status === "copying"}
              size="md"
            />
            {job.total_size_bytes > 0 && (
              <>
                <Group justify="space-between" mt="xs">
                  <Text size="sm">{t("jobDetail.sizeProgress")}</Text>
                  <Text size="sm" fw={500}>
                    {formatBytes(job.copied_size_bytes)} /{" "}
                    {formatBytes(job.total_size_bytes)}
                  </Text>
                </Group>
                <Progress
                  value={Math.round(
                    (job.copied_size_bytes / job.total_size_bytes) * 100,
                  )}
                  color="teal"
                  animated={job.status === "copying"}
                  size="md"
                />
              </>
            )}
            {/* Elapsed / Speed / ETA strip */}
            {job.copy_started_at && (
              <>
                <Divider my="xs" />
                <Group gap="xl" wrap="nowrap">
                  <Stack gap={2} align="center" style={{ flex: 1 }}>
                    <Text size="xs" c="dimmed">
                      {finalElapsedSec !== null
                        ? t("jobDetail.totalTime")
                        : t("jobDetail.elapsed")}
                    </Text>
                    <Text size="sm" fw={600}>
                      {formatDuration(
                        finalElapsedSec !== null ? finalElapsedSec : elapsedSec,
                      )}
                    </Text>
                  </Stack>
                  {isJobCopying && (
                    <>
                      <Stack gap={2} align="center" style={{ flex: 1 }}>
                        <Text size="xs" c="dimmed">
                          {t("jobDetail.speed")}
                        </Text>
                        <Text size="sm" fw={600}>
                          {copySpeed > 0
                            ? formatSpeed(copySpeed)
                            : t("jobDetail.calculating")}
                        </Text>
                      </Stack>
                      <Stack gap={2} align="center" style={{ flex: 1 }}>
                        <Text size="xs" c="dimmed">
                          {t("jobDetail.eta")}
                        </Text>
                        <Text size="sm" fw={600}>
                          {etaSec !== null
                            ? formatDuration(etaSec)
                            : t("jobDetail.calculating")}
                        </Text>
                      </Stack>
                    </>
                  )}
                </Group>
              </>
            )}
          </Stack>
        </Paper>
      )}

      {/* Tabbed content: Files | Migration */}
      <Tabs defaultValue="files">
        <Tabs.List>
          <Tabs.Tab value="files" leftSection={<FileText size={14} />}>
            {t("jobDetail.fileRecords")}
            {filesData && (
              <Badge size="xs" variant="light" color="gray" ml="xs">
                {filesData.total.toLocaleString()}
              </Badge>
            )}
          </Tabs.Tab>
          <Tabs.Tab value="migration" leftSection={<Database size={14} />}>
            {t("migration.tab")}
            {migration && migration.total > 0 && (
              <Badge size="xs" variant="light" color="teal" ml="xs">
                {migration.migrated}/{migration.total}
              </Badge>
            )}
          </Tabs.Tab>
        </Tabs.List>

        {/* ── Files tab ── */}
        <Tabs.Panel value="files" pt="md">
          <Group justify="space-between" align="flex-end" mb="sm">
            <Group gap="xs" align="center">
              <Text fw={600}>{t("jobDetail.fileRecords")}</Text>
            </Group>
            <Group gap="xs">
              <Select
                size="xs"
                w={140}
                placeholder={t("jobDetail.filterStatus")}
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter((v as FileStatus | "") ?? "");
                  setPage(1);
                }}
                clearable
                data={[
                  { value: "pending", label: t("status.pending") },
                  { value: "copied", label: t("status.copied") },
                  { value: "failed", label: t("status.failed") },
                  { value: "skipped", label: t("status.skipped") },
                ]}
              />
              <Tooltip label={t("common.retry")}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={() => {
                    refetchJob();
                    refetchFiles();
                  }}
                >
                  <RefreshCw size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          {filesLoading && (
            <Stack gap="xs">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} height={44} radius="sm" />
              ))}
            </Stack>
          )}

          {filesData && filesData.files.length === 0 && (
            <Alert icon={<Clock size={16} />} color="gray">
              {t("jobDetail.noFiles")}
            </Alert>
          )}

          {filesData && filesData.files.length > 0 && (
            <Paper withBorder style={{ overflow: "auto" }}>
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("jobDetail.fileName")}</Table.Th>
                    <Table.Th>{t("jobDetail.status")}</Table.Th>
                    <Table.Th>{t("jobDetail.size")}</Table.Th>
                    <Table.Th>{t("jobDetail.transferSpeed")}</Table.Th>
                    <Table.Th>{t("jobDetail.path")}</Table.Th>
                    <Table.Th>{t("jobDetail.mime")}</Table.Th>
                    <Table.Th>{t("jobDetail.error")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {filesData.files.map((file) => {
                    const prog = fileProgressProps(file, isJobCopying ?? false);
                    return (
                      <Table.Tr key={file.id}>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap" align="center">
                            <Text
                              size="sm"
                              fw={500}
                              truncate
                              style={{ flex: 1, minWidth: 0 }}
                            >
                              {file.file_name}
                            </Text>
                            <Progress
                              value={prog.value}
                              color={prog.color}
                              animated={prog.animated}
                              size={6}
                              radius="xl"
                              style={{ width: 60, flexShrink: 0 }}
                            />
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <FileStatusBadge status={file.status} />
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {file.file_size_bytes
                              ? formatBytes(file.file_size_bytes)
                              : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {file.transfer_speed_bps
                              ? formatSpeed(file.transfer_speed_bps)
                              : "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip
                            label={file.full_path}
                            openDelay={400}
                            withArrow
                          >
                            <Text size="xs" c="dimmed" truncate maw={280}>
                              {file.full_path}
                            </Text>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {file.mime_type ?? "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {file.error_msg ? (
                            <Tooltip
                              label={file.error_msg}
                              openDelay={300}
                              withArrow
                              multiline
                              maw={300}
                            >
                              <Text size="xs" c="red" truncate maw={180}>
                                {file.error_msg}
                              </Text>
                            </Tooltip>
                          ) : (
                            <Text size="xs" c="dimmed">
                              —
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          {totalPages > 1 && (
            <Group justify="center" mt="sm">
              <Pagination
                total={totalPages}
                value={page}
                onChange={setPage}
                size="sm"
              />
            </Group>
          )}
        </Tabs.Panel>

        {/* ── Migration tab ── */}
        <Tabs.Panel value="migration" pt="md">
          <Stack gap="md">
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
                  href={api.migration.sqlUrl(id)}
                  download
                >
                  {t("migration.downloadSql")}
                </Button>
              )}
              {migration && migration.migrated > 0 && job?.status !== "migrating" && (
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
                      ? Math.round((migration.migrated / migration.total) * 100)
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
                          <Text size="xs" truncate maw={180} title={rec.original_name ?? ""}>
                            {rec.original_name ?? "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed" truncate maw={220} title={rec.original_path ?? ""}>
                            {rec.original_path ?? "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" truncate maw={180}>
                            {rec.uuid_filename ?? "—"}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <MigrationStatusBadge status={rec.status} />
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
                            {rec.migrated_at
                              ? formatDate(rec.migrated_at)
                              : "—"}
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
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
