import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  useJob,
  useJobAction,
  useDeleteJob,
  useMigrationActions,
} from "@/hooks/useJobs";
import { utcMs } from "@/utils";
export function useJobDetail(id: number) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    data: job,
    isPending: jobLoading,
    isError,
    refetch: refetchJob,
  } = useJob(id);

  const actions = useJobAction(id);
  const deleteJob = useDeleteJob();
  const migrationActions = useMigrationActions(id);

  const isJobActive =
    job?.status === "copying" ||
    job?.status === "scanning" ||
    job?.status === "migrating";
  const isJobCopying = job?.status === "copying";

  // ---- Copy speed / elapsed / ETA ----
  const prevSnapshotRef = useRef<{ bytes: number; time: number } | null>(null);
  const [copySpeed, setCopySpeed] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

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

  useEffect(() => {
    if (!isJobCopying || !job?.copy_started_at) return;
    const startMs = utcMs(job.copy_started_at);
    setElapsedSec(Math.floor((Date.now() - startMs) / 1000));
    const timerId = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startMs) / 1000));
    }, 1000);
    return () => clearInterval(timerId);
  }, [isJobCopying, job?.copy_started_at]);

  const finalElapsedSec =
    job?.copy_started_at &&
    (job.status === "done" ||
      job.status === "failed" ||
      job.status === "paused")
      ? Math.floor((utcMs(job.updated_at) - utcMs(job.copy_started_at)) / 1000)
      : null;

  const remainingBytes =
    (job?.total_size_bytes ?? 0) - (job?.copied_size_bytes ?? 0);
  const etaSec =
    isJobCopying && copySpeed > 0 ? remainingBytes / copySpeed : null;

  const copyProgress =
    job && job.total_files > 0
      ? Math.round((job.copied_files / job.total_files) * 100)
      : 0;

  const scanProgress =
    job && job.total_files > 0
      ? Math.round((job.scanned_files / job.total_files) * 100)
      : 0;

  // ---- Modal state (delete only — revert modal lives in MigrationTab) ----
  const [deleteOpened, { open: openDelete, close: closeDelete }] =
    useDisclosure();

  // ---- Action handlers ----
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

  return {
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
  };
}
