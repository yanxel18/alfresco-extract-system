import { Box, Checkbox, Group, Text, Skeleton, Tooltip } from "@mantine/core";
import {
  File,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  Sheet,
  Presentation,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FileNodeBrief } from "@/api/client";
import { formatBytes, formatDate } from "@/utils";

function getMimeIcon(mime?: string) {
  if (!mime) return <File size={15} />;
  if (mime.startsWith("image/"))
    return <Image size={15} color="var(--mantine-color-teal-6)" />;
  if (mime.startsWith("video/"))
    return <Film size={15} color="var(--mantine-color-grape-6)" />;
  if (mime.startsWith("audio/"))
    return <Music size={15} color="var(--mantine-color-orange-6)" />;
  if (
    mime.includes("spreadsheet") ||
    mime.includes("excel") ||
    mime.includes("csv")
  )
    return <Sheet size={15} color="var(--mantine-color-green-6)" />;
  if (mime.includes("presentation") || mime.includes("powerpoint"))
    return <Presentation size={15} color="var(--mantine-color-orange-5)" />;
  if (
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("text") ||
    mime.includes("rtf")
  )
    return <FileText size={15} color="var(--mantine-color-blue-6)" />;
  if (mime.includes("zip") || mime.includes("compressed"))
    return <Archive size={15} color="var(--mantine-color-yellow-6)" />;
  return <File size={15} color="var(--mantine-color-gray-5)" />;
}

interface SearchResultListProps {
  results: FileNodeBrief[];
  isLoading?: boolean;
  selectedFileIds: Set<number>;
  onToggleFile: (nodeId: number, checked: boolean) => void;
}

export function SearchResultList({
  results,
  isLoading,
  selectedFileIds,
  onToggleFile,
}: SearchResultListProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <Box>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={34} mb={2} radius="sm" />
        ))}
      </Box>
    );
  }

  if (results.length === 0) {
    return (
      <Text size="sm" c="dimmed" ta="center" py="xl">
        {t("common.noResults")}
      </Text>
    );
  }

  return (
    <Box>
      {/* Column header */}
      <Group
        gap={0}
        py={4}
        px={4}
        mb={2}
        wrap="nowrap"
        style={{
          borderBottom: "1px solid var(--mantine-color-default-border)",
          userSelect: "none",
        }}
      >
        <Box style={{ width: 28, flexShrink: 0 }} />
        <Box style={{ width: 24, flexShrink: 0 }} />
        <Text size="xs" c="dimmed" fw={600} style={{ flex: 1 }}>
          {t("explorer.columns.name")}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          fw={600}
          w={120}
          ta="right"
          style={{ flexShrink: 0, paddingRight: 8 }}
        >
          {t("explorer.columns.modifier")}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          fw={600}
          w={145}
          style={{ flexShrink: 0, paddingRight: 8 }}
        >
          {t("explorer.columns.modified")}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          fw={600}
          w={68}
          ta="right"
          style={{ flexShrink: 0 }}
        >
          {t("explorer.columns.size")}
        </Text>
      </Group>

      {results.map((file) => (
        <Group
          key={file.node_id}
          gap={0}
          py={5}
          px={4}
          wrap="nowrap"
          className="tree-node"
          style={{ borderRadius: "var(--mantine-radius-sm)" }}
        >
          <Checkbox
            size="sm"
            checked={selectedFileIds.has(file.node_id)}
            onChange={(e) =>
              onToggleFile(file.node_id, e.currentTarget.checked)
            }
            onClick={(e) => e.stopPropagation()}
            style={{ flexShrink: 0, marginRight: 6 }}
          />
          <Box
            style={{
              width: 24,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
            }}
          >
            {getMimeIcon(file.mime_type)}
          </Box>
          <Tooltip label={file.name} openDelay={600} withArrow>
            <Text
              size="sm"
              truncate
              style={{ flex: 1, minWidth: 60, paddingLeft: 4 }}
            >
              {file.name}
            </Text>
          </Tooltip>
          <Text
            size="xs"
            c="dimmed"
            w={120}
            truncate
            ta="right"
            style={{ flexShrink: 0, paddingRight: 8 }}
          >
            {file.modifier ?? "—"}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            w={145}
            style={{ flexShrink: 0, paddingRight: 8 }}
          >
            {formatDate(file.modified_at)}
          </Text>
          <Text
            size="xs"
            c="dimmed"
            w={68}
            ta="right"
            style={{ flexShrink: 0 }}
          >
            {file.size_bytes != null ? formatBytes(file.size_bytes) : "—"}
          </Text>
        </Group>
      ))}
    </Box>
  );
}
