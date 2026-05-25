import { useState, useEffect, useRef } from "react";
import {
  Stack,
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
  Select,
  Pagination,
  Divider,
  Grid,
  Card,
  ThemeIcon,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  RefreshCw,
  Clock,
  FileText,
  AlertCircle,
  CheckCircle,
  XCircle,
  Minus,
} from "lucide-react";
import { useJobFiles } from "@/hooks/useJobs";
import { FileStatusBadge } from "@/components/StatusBadge";
import { formatBytes, formatSpeed } from "@/utils";
import type { FileStatus, FileRecord } from "@/api/client";

const PAGE_SIZE = 100;

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

interface FilesTabProps {
  jobId: number;
  jobStatus?: string;
  isJobCopying: boolean;
  refetchJob: () => void;
}

/** Files tab: filterable, paginated file record list with live copy progress. */
export function FilesTab({
  jobId,
  jobStatus,
  isJobCopying,
  refetchJob,
}: FilesTabProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<FileStatus | "">("");

  const {
    data: filesData,
    isPending: filesLoading,
    refetch: refetchFiles,
  } = useJobFiles(jobId, page, PAGE_SIZE, statusFilter || undefined, jobStatus);

  // When copying finishes, do one final refresh so the last file gets its true status.
  const prevJobStatusRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = prevJobStatusRef.current;
    if (prev === "copying" && jobStatus !== "copying") {
      refetchFiles();
    }
    prevJobStatusRef.current = jobStatus;
  }, [jobStatus]);

  const totalPages = filesData ? Math.ceil(filesData.total / PAGE_SIZE) : 1;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-end">
        <Group gap="xs" align="center">
          <Text fw={600}>{t("jobDetail.fileRecords")}</Text>
          {filesData && (
            <Badge size="xs" variant="light" color="gray">
              {filesData.total.toLocaleString()}
            </Badge>
          )}
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
            <Paper key={i} withBorder h={44} />
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
                const prog = fileProgressProps(file, isJobCopying);
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
                      <FileStatusBadge
                        status={file.status}
                        active={isJobCopying}
                      />
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
    </Stack>
  );
}
