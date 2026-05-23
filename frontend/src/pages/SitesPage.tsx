import {
  Grid,
  Card,
  Text,
  Group,
  Button,
  Badge,
  TextInput,
  Skeleton,
  Alert,
  Stack,
  Title,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import {
  Search,
  FolderSearch,
  Download,
  AlertCircle,
  RefreshCw,
  Globe,
} from "lucide-react";
import { useSites } from "@/hooks/useSites";
import { useCreateJob } from "@/hooks/useJobs";
import { notifications } from "@mantine/notifications";

export function SitesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: sites, isPending, isError, refetch } = useSites();
  const createJob = useCreateJob();
  const [search, setSearch] = useState("");

  const filtered =
    sites?.filter(
      (s) =>
        s.short_name.toLowerCase().includes(search.toLowerCase()) ||
        s.title.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];

  const handleExtractAll = async (siteName: string) => {
    try {
      await createJob.mutateAsync({
        site_name: siteName,
        selected_folder_node_ids: [],
      });
      notifications.show({
        title: t("notifications.jobCreated", { site: siteName }),
        message: t("nav.jobs"),
        color: "green",
      });
      navigate("/jobs");
    } catch (e: any) {
      notifications.show({
        title: t("notifications.errorCreating"),
        message: e.message,
        color: "red",
      });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>{t("sites.title")}</Title>
          <Text c="dimmed" size="sm" mt={4}>
            {t("sites.subtitle")}
          </Text>
        </div>
        <Tooltip label={t("common.retry")}>
          <ActionIcon
            variant="subtle"
            onClick={() => refetch()}
            loading={isPending}
          >
            <RefreshCw size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <TextInput
        placeholder={t("sites.searchPlaceholder")}
        leftSection={<Search size={16} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
        w={{ base: "100%", sm: 320 }}
      />

      {isError && (
        <Alert
          icon={<AlertCircle size={16} />}
          color="red"
          title={t("common.error")}
        >
          {t("common.error")}
        </Alert>
      )}

      {isPending && (
        <Grid>
          {Array.from({ length: 6 }).map((_, i) => (
            <Grid.Col key={i} span={{ base: 12, sm: 6, lg: 4 }}>
              <Skeleton height={160} radius="md" />
            </Grid.Col>
          ))}
        </Grid>
      )}

      {!isPending && filtered.length === 0 && !isError && (
        <Alert
          icon={<Globe size={16} />}
          color="blue"
          title={t("sites.noSites")}
        >
          {t("sites.noSitesHint")}
        </Alert>
      )}

      <Grid>
        {filtered.map((site) => (
          <Grid.Col key={site.short_name} span={{ base: 12, sm: 6, lg: 4 }}>
            <Card h={180} style={{ display: "flex", flexDirection: "column" }}>
              <Group justify="space-between" mb={8}>
                <Badge variant="light" color="brand" size="sm">
                  {site.short_name}
                </Badge>
              </Group>

              <Text fw={600} size="md" lineClamp={1} mb={4}>
                {site.title}
              </Text>
              <Text size="sm" c="dimmed" lineClamp={2} style={{ flex: 1 }}>
                {site.description || "—"}
              </Text>

              <Group mt="auto" pt="md" gap="xs">
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<FolderSearch size={14} />}
                  onClick={() => navigate(`/sites/${site.short_name}/explore`)}
                  style={{ flex: 1 }}
                >
                  {t("sites.browse")}
                </Button>
                <Button
                  size="xs"
                  leftSection={<Download size={14} />}
                  onClick={() => handleExtractAll(site.short_name)}
                  loading={createJob.isPending}
                  style={{ flex: 1 }}
                >
                  {t("sites.extractAll")}
                </Button>
              </Group>
            </Card>
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}
