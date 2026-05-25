import { useContext } from "react";
import { Box, Group, Text, Checkbox, Tooltip } from "@mantine/core";
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
import { formatBytes, formatDate } from "@/utils";
import type { FileNodeBrief } from "@/api/client";
import { ColumnWidthContext, COL_ALIGN, type ColKey } from "./ColumnContext";

export function getMimeIcon(mime?: string) {
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

/** OneDrive-style file row with metadata columns and a selection checkbox. */
export function FileRow({
  file,
  ml,
  checked,
  onToggle,
}: {
  file: FileNodeBrief;
  ml: number;
  checked: boolean;
  onToggle: (nodeId: number, checked: boolean) => void;
}) {
  const { colWidths, colOrder } = useContext(ColumnWidthContext);

  const getCellValue = (col: ColKey) => {
    if (col === "modifier") return file.modifier ?? "—";
    if (col === "modified") return formatDate(file.modified_at);
    return file.size_bytes != null ? formatBytes(file.size_bytes) : "—";
  };

  return (
    <Group
      gap={0}
      py={5}
      px={4}
      ml={ml}
      wrap="nowrap"
      className="tree-node"
      style={{ borderRadius: "var(--mantine-radius-sm)" }}
    >
      {/* Selection checkbox */}
      <Checkbox
        size="sm"
        checked={checked}
        onChange={(e) => onToggle(file.node_id, e.currentTarget.checked)}
        onClick={(e) => e.stopPropagation()}
        style={{ flexShrink: 0, marginRight: 6 }}
      />
      <Box
        style={{
          width: 20,
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
          style={{ flex: 1, minWidth: 60, paddingLeft: 8 }}
        >
          {file.name}
        </Text>
      </Tooltip>
      {colOrder.map((col) => (
        <Text
          key={col}
          size="xs"
          c="dimmed"
          truncate
          ta={COL_ALIGN[col]}
          style={{
            width: colWidths[col],
            flexShrink: 0,
            paddingRight: 8,
          }}
        >
          {getCellValue(col)}
        </Text>
      ))}
    </Group>
  );
}
