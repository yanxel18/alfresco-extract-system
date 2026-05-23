import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, JobCreate, FileStatus } from "@/api/client";

export function useJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: api.jobs.list,
    refetchInterval: 4_000,
  });
}

export function useJob(id: number) {
  return useQuery({
    queryKey: ["jobs", id],
    queryFn: () => api.jobs.get(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "scanning" ||
        status === "copying" ||
        status === "migrating"
        ? 3_000
        : false;
    },
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: JobCreate) => api.jobs.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.jobs.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useJobAction(id: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["jobs", id] });
  };
  const startCopy = useMutation({
    mutationFn: () => api.jobs.startCopy(id),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: () => api.jobs.pause(id),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => api.jobs.resume(id),
    onSuccess: invalidate,
  });
  return { startCopy, pause, resume };
}

export function useJobFiles(
  jobId: number,
  page: number = 1,
  limit: number = 100,
  status?: FileStatus,
  jobStatus?: string,
) {
  return useQuery({
    queryKey: ["jobs", jobId, "files", { page, limit, status }],
    queryFn: () =>
      api.files.list(jobId, {
        status,
        limit,
        offset: (page - 1) * limit,
      }),
    refetchInterval:
      jobStatus === "copying" || jobStatus === "scanning" ? 2_000 : false,
  });
}

export function useMigration(jobId: number, jobStatus?: string) {
  return useQuery({
    queryKey: ["jobs", jobId, "migration"],
    queryFn: () => api.migration.get(jobId),
    enabled:
      !!jobStatus &&
      !["created", "scanning", "scanned", "copying"].includes(jobStatus),
    refetchInterval: (query) => {
      // Base polling on the status field returned in the migration response,
      // not on the prop — this ensures the interval reacts to the actual
      // server state and always captures the final transition to migrated/failed.
      const status = query.state.data?.status;
      return status === "migrating" ? 3_000 : false;
    },
  });
}

export function useMigrationActions(jobId: number) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["jobs", jobId, "migration"] });
    qc.invalidateQueries({ queryKey: ["jobs", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  const start = useMutation({
    mutationFn: () => api.migration.start(jobId),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: () => api.migration.pause(jobId),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => api.migration.resume(jobId),
    onSuccess: invalidate,
  });
  const revert = useMutation({
    mutationFn: () => api.migration.revert(jobId),
    onSuccess: invalidate,
  });
  return { start, pause, resume, revert };
}
