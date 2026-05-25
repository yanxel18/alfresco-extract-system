import { Group, Button, Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Play, Pause, RotateCcw, Download, Trash2 } from "lucide-react";
import type { Job } from "@/api/client";

interface JobActionButtonsProps {
  job: Job;
  isJobActive: boolean;
  actions: {
    startCopy: { isPending: boolean };
    pause: { isPending: boolean };
    resume: { isPending: boolean };
  };
  deleteJob: { isPending: boolean };
  handleStartCopy: () => void;
  handlePause: () => void;
  handleResume: () => void;
  openDelete: () => void;
}

/** Action button strip shown in the job detail page header. */
export function JobActionButtons({
  job,
  isJobActive,
  actions,
  deleteJob,
  handleStartCopy,
  handlePause,
  handleResume,
  openDelete,
}: JobActionButtonsProps) {
  const { t } = useTranslation();

  return (
    <Group gap="xs">
      {job.status === "scanned" && (
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

      {(job.status === "copying" || job.status === "scanning") && (
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

      {(job.status === "paused" || job.status === "failed") && (
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
    </Group>
  );
}
