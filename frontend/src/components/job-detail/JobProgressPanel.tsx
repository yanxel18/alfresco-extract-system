import { Stack, Group, Text, Paper, Progress, Divider } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { formatBytes, formatDuration, formatSpeed } from "@/utils";
import type { Job } from "@/api/client";

interface JobProgressPanelProps {
  job: Job;
  copySpeed: number;
  elapsedSec: number;
  finalElapsedSec: number | null;
  etaSec: number | null;
  isJobCopying: boolean;
  copyProgress: number;
  scanProgress: number;
}

/** Scan progress, copy progress, size progress, and elapsed/speed/ETA strip. */
export function JobProgressPanel({
  job,
  copySpeed,
  elapsedSec,
  finalElapsedSec,
  etaSec,
  isJobCopying,
  copyProgress,
  scanProgress,
}: JobProgressPanelProps) {
  const { t } = useTranslation();

  return (
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
  );
}
