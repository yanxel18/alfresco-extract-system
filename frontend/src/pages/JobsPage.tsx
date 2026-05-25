import {
  Stack,
  Title,
  Group,
  Text,
  Button,
  Paper,
  Alert,
  ActionIcon,
  Tooltip,
  Table,
  Skeleton,
  ThemeIcon,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { RefreshCw, AlertCircle, Briefcase } from "lucide-react";
import { useJobs } from "@/hooks/useJobs";
import { JobRow } from "@/components/JobRow";

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
