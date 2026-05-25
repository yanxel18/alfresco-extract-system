import {
  Stack,
  Title,
  Group,
  Text,
  Button,
  Alert,
  ActionIcon,
  Skeleton,
  Modal,
  Tabs,
  Grid,
  Card,
  ThemeIcon,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  AlertCircle,
  FileText,
  Database,
  Trash2,
  CheckCircle,
  XCircle,
  Minus,
} from "lucide-react";
import { JobStatusBadge } from "@/components/StatusBadge";
import { formatBytes } from "@/utils";
import { useJobDetail } from "@/hooks/useJobDetail";
import { JobActionButtons } from "@/components/job-detail/JobActionButtons";
import { JobProgressPanel } from "@/components/job-detail/JobProgressPanel";
import { FilesTab } from "@/components/job-detail/FilesTab";
import { MigrationTab } from "@/components/job-detail/MigrationTab";

export function JobDetailPage() {
  const { t } = useTranslation();
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const id = Number(jobId);

  const {
    job,
    jobLoading,
    isError,
    refetchJob,
    actions,
    deleteJob,
    migrationActions,
    isJobActive,
    isJobCopying,
    copySpeed,
    elapsedSec,
    finalElapsedSec,
    etaSec,
    copyProgress,
    scanProgress,
    deleteOpened,
    openDelete,
    closeDelete,
    handleStartCopy,
    handlePause,
    handleResume,
    handleDelete,
  } = useJobDetail(id);

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

        {job && (
          <JobActionButtons
            job={job}
            isJobActive={isJobActive}
            actions={actions}
            deleteJob={deleteJob}
            handleStartCopy={handleStartCopy}
            handlePause={handlePause}
            handleResume={handleResume}
            openDelete={openDelete}
          />
        )}
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

      {/* Progress bars + elapsed/speed/ETA */}
      {job && (
        <JobProgressPanel
          job={job}
          copySpeed={copySpeed}
          elapsedSec={elapsedSec}
          finalElapsedSec={finalElapsedSec}
          etaSec={etaSec}
          isJobCopying={isJobCopying}
          copyProgress={copyProgress}
          scanProgress={scanProgress}
        />
      )}

      {/* Tabbed content: Files | Migration */}
      <Tabs defaultValue="files">
        <Tabs.List>
          <Tabs.Tab value="files" leftSection={<FileText size={14} />}>
            {t("jobDetail.fileRecords")}
          </Tabs.Tab>
          <Tabs.Tab value="migration" leftSection={<Database size={14} />}>
            {t("migration.tab")}
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="files" pt="md">
          <FilesTab
            jobId={id}
            jobStatus={job?.status}
            isJobCopying={isJobCopying}
            refetchJob={refetchJob}
          />
        </Tabs.Panel>

        <Tabs.Panel value="migration" pt="md">
          <MigrationTab
            jobId={id}
            job={job}
            migrationActions={migrationActions}
          />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
