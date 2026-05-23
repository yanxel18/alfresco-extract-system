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
  ThemeIcon,
  Modal,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  RefreshCw,
  Play,
  Pause,
  RotateCcw,
  Download,
  Eye,
  AlertCircle,
  Briefcase,
  Trash2,
} from "lucide-react";
import { useJobs, useJobAction, useDeleteJob } from "@/hooks/useJobs";
import { JobStatusBadge } from "@/components/StatusBadge";
import { notifications } from "@mantine/notifications";
import { formatDate } from "@/utils";
import type { Job } from "@/api/client";
import { useState } from "react";

function formatDuration(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function jobDuration(job: Job): string {
  if (!job.copy_started_at) return "—";
  const start = new Date(job.copy_started_at).getTime();
  const end =
    job.status === "done" || job.status === "failed" || job.status === "paused"
      ? new Date(job.updated_at).getTime()
      : Date.now();
  return formatDuration(Math.floor((end - start) / 1000));
}

function JobRow({ job }: { job: Job }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { startCopy, pause, resume } = useJobAction(job.id);
  const deleteJob = useDeleteJob();
  const [deleteOpened, { open: openDelete, close: closeDelete }] =
    useDisclosure();

  const copyProgress =
    job.total_files > 0
      ? Math.round((job.copied_files / job.total_files) * 100)
      : 0;
  const scanProgress =
    job.total_files > 0
      ? Math.round((job.scanned_files / job.total_files) * 100)
      : 0;

  const handleAction = async (
    action: "startCopy" | "pause" | "resume",
    msgKey: string,
  ) => {
    try {
      const actions = { startCopy, pause, resume };
      await actions[action].mutateAsync();
      notifications.show({
        message: t(msgKey, { id: job.id }),
        color: "green",
      });
    } catch (e: any) {
      notifications.show({
        title: t("notifications.errorAction"),
        message: e.message,
        color: "red",
      });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteJob.mutateAsync(job.id);
      notifications.show({
        message: t("notifications.jobDeleted", { id: job.id }),
        color: "green",
      });
      closeDelete();
    } catch (e: any) {
      notifications.show({
        title: t("notifications.errorDeleting"),
        message: e.message,
        color: "red",
      });
    }
  };

  return (
    <>
      <Table.Tr>
        <Table.Td>
          <Text size="sm" fw={500} c="dimmed">
            #{job.id}
          </Text>
        </Table.Td>
        <Table.Td>
          <div>
            <Text size="sm" fw={500}>
              {job.site_title ?? job.site_name}
            </Text>
            {job.site_title && (
              <Text size="xs" c="dimmed">
                {job.site_name}
              </Text>
            )}
          </div>
        </Table.Td>
        <Table.Td>
          <JobStatusBadge status={job.status} />
        </Table.Td>
        <Table.Td>
          <Text size="sm">
            {job.scanned_files} / {job.total_files}
          </Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm">{job.copied_files}</Text>
        </Table.Td>
        <Table.Td>
          <Text size="sm" c={job.failed_files > 0 ? "red" : undefined}>
            {job.failed_files}
          </Text>
        </Table.Td>
        <Table.Td w={160}>
          <Stack gap={4}>
            <Progress
              size="xs"
              value={scanProgress}
              color="cyan"
              animated={job.status === "scanning"}
            />
            <Progress
              size="xs"
              value={copyProgress}
              color="green"
              animated={job.status === "copying"}
            />
          </Stack>
        </Table.Td>
        <Table.Td>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            {jobDuration(job)}
          </Text>
        </Table.Td>
        <Table.Td>
          <Group gap={4} wrap="nowrap">
            <Tooltip label={t("jobs.viewFiles")}>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => navigate(`/jobs/${job.id}`)}
              >
                <Eye size={14} />
              </ActionIcon>
            </Tooltip>

            {job.status === "scanned" && (
              <Tooltip label={t("jobs.startCopy")}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  color="green"
                  onClick={() =>
                    handleAction("startCopy", "notifications.jobStartCopy")
                  }
                  loading={startCopy.isPending}
                >
                  <Play size={14} />
                </ActionIcon>
              </Tooltip>
            )}

            {(job.status === "scanning" || job.status === "copying") && (
              <Tooltip label={t("jobs.pause")}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  color="orange"
                  onClick={() =>
                    handleAction("pause", "notifications.jobPaused")
                  }
                  loading={pause.isPending}
                >
                  <Pause size={14} />
                </ActionIcon>
              </Tooltip>
            )}

            {(job.status === "paused" || job.status === "failed") && (
              <Tooltip label={t("jobs.resume")}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  color="blue"
                  onClick={() =>
                    handleAction("resume", "notifications.jobResumed")
                  }
                  loading={resume.isPending}
                >
                  <RotateCcw size={14} />
                </ActionIcon>
              </Tooltip>
            )}

            {(job.status === "done" || job.status === "scanned") && (
              <Tooltip label={t("jobs.downloadCsv")}>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  color="gray"
                  component="a"
                  href={`/api/jobs/${job.id}/csv`}
                  download
                >
                  <Download size={14} />
                </ActionIcon>
              </Tooltip>
            )}

            <Tooltip label={t("jobs.delete")}>
              <ActionIcon
                variant="subtle"
                size="sm"
                color="red"
                onClick={openDelete}
              >
                <Trash2 size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>

      {/* Delete confirmation modal */}
      <Modal
        opened={deleteOpened}
        onClose={closeDelete}
        title={t("jobs.deleteConfirmTitle", { id: job.id })}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">{t("jobs.deleteConfirmMsg")}</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDelete}>
              {t("common.cancel")}
            </Button>
            <Button
              color="red"
              loading={deleteJob.isPending}
              onClick={handleDelete}
            >
              {t("jobs.delete")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

export function JobsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: jobs, isPending, isError, refetch } = useJobs();

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>{t("jobs.title")}</Title>
          <Text c="dimmed" size="sm" mt={4}>
            {jobs ? `${jobs.length} total` : ""}
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label={t("common.retry")}>
            <ActionIcon
              variant="subtle"
              onClick={() => refetch()}
              loading={isPending}
            >
              <RefreshCw size={16} />
            </ActionIcon>
          </Tooltip>
          <Button size="sm" onClick={() => navigate("/sites")}>
            {t("jobs.newJob")}
          </Button>
        </Group>
      </Group>

      {isError && (
        <Alert icon={<AlertCircle size={16} />} color="red">
          {t("common.error")}
        </Alert>
      )}

      {isPending && (
        <Stack gap="xs">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={52} radius="sm" />
          ))}
        </Stack>
      )}

      {!isPending && !isError && jobs?.length === 0 && (
        <Paper withBorder p="xl" ta="center">
          <ThemeIcon size={48} variant="light" color="gray" mx="auto" mb="md">
            <Briefcase size={24} />
          </ThemeIcon>
          <Text fw={500}>{t("jobs.noJobs")}</Text>
          <Text size="sm" c="dimmed" mt={4}>
            {t("jobs.noJobsHint")}
          </Text>
          <Button mt="lg" onClick={() => navigate("/sites")}>
            {t("jobs.newJob")}
          </Button>
        </Paper>
      )}

      {jobs && jobs.length > 0 && (
        <Paper withBorder style={{ overflow: "hidden" }}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("jobs.id")}</Table.Th>
                <Table.Th>{t("jobs.site")}</Table.Th>
                <Table.Th>{t("jobs.status")}</Table.Th>
                <Table.Th>{t("jobs.scanned")}</Table.Th>
                <Table.Th>{t("jobs.copied")}</Table.Th>
                <Table.Th>{t("jobs.failed")}</Table.Th>
                <Table.Th>{t("jobs.progress")}</Table.Th>
                <Table.Th>{t("jobs.duration")}</Table.Th>
                <Table.Th>{t("jobs.actions")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
