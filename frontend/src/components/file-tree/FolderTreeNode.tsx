import { useCallback, useContext } from "react";
import {
  Box,
  Group,
  Text,
  Checkbox,
  ActionIcon,
  Loader,
  Tooltip,
} from "@mantine/core";
import { ChevronRight, ChevronDown, Folder, FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { ColumnWidthContext, type TreeNodeState } from "./ColumnContext";
import { FileRow } from "./FileRow";

/** Recursively collect all loaded file node IDs from a folder and its descendants. */
export function collectFileIds(node: TreeNodeState): number[] {
  const ids: number[] = (node.files ?? []).map((f) => f.node_id);
  for (const child of node.children ?? []) {
    ids.push(...collectFileIds(child));
  }
  return ids;
}

/** Recursively collect all loaded child folder node IDs from a folder's descendants. */
export function collectFolderIds(node: TreeNodeState): number[] {
  const ids: number[] = [];
  for (const child of node.children ?? []) {
    if (child.selectable !== false) ids.push(child.node_id);
    ids.push(...collectFolderIds(child));
  }
  return ids;
}

/** Immutably update a node by id anywhere in the tree. */
export function updateNode(
  nodes: TreeNodeState[],
  targetId: number,
  patch: Partial<TreeNodeState>,
): TreeNodeState[] {
  return nodes.map((n) => {
    if (n.node_id === targetId) return { ...n, ...patch };
    if (n.children)
      return { ...n, children: updateNode(n.children, targetId, patch) };
    return n;
  });
}

interface NodeProps {
  siteName: string;
  node: TreeNodeState;
  depth: number;
  selectedIds: Set<number>;
  onToggle: (nodeId: number, checked: boolean) => void;
  onBulkToggle: (nodeIds: number[], checked: boolean) => void;
  selectedFileIds: Set<number>;
  onToggleFile: (nodeId: number, checked: boolean) => void;
  onBulkToggleFiles: (fileIds: number[], checked: boolean) => void;
  /** Stable root-level updater — uses setNodes functional form, always fresh state. */
  onUpdate: (nodeId: number, patch: Partial<TreeNodeState>) => void;
  onRegisterItems?: (
    folderIds: number[],
    fileIds: number[],
    fileSizeMap: Map<number, number>,
    fileParentMap: Map<number, number>,
    folderParentMap: Map<number, number>,
  ) => void;
}

export function FolderTreeNode({
  siteName,
  node,
  depth,
  selectedIds,
  onToggle,
  onBulkToggle,
  selectedFileIds,
  onToggleFile,
  onBulkToggleFiles,
  onUpdate,
  onRegisterItems,
}: NodeProps) {
  const { t } = useTranslation();

  const handleExpand = useCallback(async () => {
    if (node.is_shortcut && !node.has_children) {
      return;
    }
    if (node.expanded) {
      onUpdate(node.node_id, { expanded: false });
      return;
    }
    if (node.children !== undefined) {
      onUpdate(node.node_id, { expanded: true });
      if (selectedIds.has(node.node_id)) {
        const childFolderIds = node.children
          .filter((c) => c.selectable !== false)
          .map((c) => c.node_id);
        if (childFolderIds.length > 0) onBulkToggle(childFolderIds, true);
        const childFileIds = (node.files ?? []).map((f) => f.node_id);
        if (childFileIds.length > 0) onBulkToggleFiles(childFileIds, true);
      }
      return;
    }
    onUpdate(node.node_id, { loading: true });
    try {
      const result = await api.browse.get(siteName, node.node_id);
      const children: TreeNodeState[] = result.folders.map((f) => ({
        ...f,
        expanded: false,
        loading: false,
      }));
      onUpdate(node.node_id, {
        expanded: true,
        loading: false,
        children,
        files: result.files,
      });
      if (onRegisterItems) {
        const sizeMap = new Map<number, number>(
          result.files.map((f) => [f.node_id, f.size_bytes ?? 0]),
        );
        const fileParMap = new Map<number, number>(
          result.files.map((f) => [f.node_id, node.node_id]),
        );
        const folderParMap = new Map<number, number>(
          children
            .filter((c) => c.selectable !== false)
            .map((c) => [c.node_id, node.node_id]),
        );
        onRegisterItems(
          children.filter((c) => c.selectable !== false).map((c) => c.node_id),
          result.files.map((f) => f.node_id),
          sizeMap,
          fileParMap,
          folderParMap,
        );
      }
      if (selectedIds.has(node.node_id)) {
        const childFolderIds = children
          .filter((c) => c.selectable !== false)
          .map((c) => c.node_id);
        if (childFolderIds.length > 0) onBulkToggle(childFolderIds, true);
        const childFileIds = result.files.map((f) => f.node_id);
        if (childFileIds.length > 0) onBulkToggleFiles(childFileIds, true);
      }
    } catch {
      onUpdate(node.node_id, { loading: false });
    }
  }, [
    node.expanded,
    node.children,
    node.node_id,
    node.files,
    siteName,
    onUpdate,
    onRegisterItems,
    selectedIds,
    onBulkToggle,
    onBulkToggleFiles,
  ]);

  const { colWidths, colOrder } = useContext(ColumnWidthContext);
  const isSelected = selectedIds.has(node.node_id);
  const indent = depth * 20;
  const fileIndent = indent + 68;

  return (
    <Box>
      <Group
        gap={0}
        py={5}
        px={4}
        ml={indent}
        wrap="nowrap"
        className="tree-node"
        style={{
          borderRadius: "var(--mantine-radius-sm)",
          cursor: "pointer",
          transition: "background 0.12s",
        }}
      >
        {/* Expand/collapse toggle */}
        <ActionIcon
          size={22}
          variant="subtle"
          onClick={handleExpand}
          disabled={!node.has_children && !node.loading}
          aria-label={
            node.expanded ? t("explorer.collapse") : t("explorer.expand")
          }
          style={{ flexShrink: 0 }}
        >
          {node.loading ? (
            <Loader size={13} />
          ) : node.expanded ? (
            <ChevronDown size={14} />
          ) : (
            <ChevronRight
              size={14}
              style={{ opacity: node.has_children ? 1 : 0.2 }}
            />
          )}
        </ActionIcon>

        {/* Selection checkbox — cascades to all loaded descendant folders and files */}
        <Checkbox
          size="sm"
          checked={isSelected}
          disabled={node.selectable === false}
          onChange={(e) => {
            const checked = e.currentTarget.checked;
            onToggle(node.node_id, checked);
            const folderIds = collectFolderIds(node);
            if (folderIds.length > 0) onBulkToggle(folderIds, checked);
            const fileIds = collectFileIds(node);
            if (fileIds.length > 0) onBulkToggleFiles(fileIds, checked);
          }}
          onClick={(e) => e.stopPropagation()}
          style={{ flexShrink: 0, marginLeft: 4, marginRight: 6 }}
        />

        {/* Folder icon + name (clickable to expand) */}
        <Group
          gap={6}
          onClick={handleExpand}
          wrap="nowrap"
          style={{ flex: 1, minWidth: 0 }}
        >
          {node.expanded ? (
            <FolderOpen
              size={16}
              color="var(--mantine-color-yellow-6)"
              style={{ flexShrink: 0 }}
            />
          ) : (
            <Folder
              size={16}
              color="var(--mantine-color-yellow-6)"
              style={{ flexShrink: 0 }}
            />
          )}
          <Tooltip label={node.name} openDelay={600} withArrow>
            <Text size="sm" fw={500} truncate style={{ flex: 1 }}>
              {node.name}
            </Text>
          </Tooltip>
          {node.is_shortcut && (
            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
              {t("explorer.shortcut")}
            </Text>
          )}
        </Group>

        {/* Empty spacers to keep header columns aligned */}
        {colOrder.map((col) => (
          <Box key={col} style={{ width: colWidths[col], flexShrink: 0 }} />
        ))}
      </Group>

      {/* Expanded content */}
      {node.expanded && (
        <Box>
          {node.files?.map((file) => (
            <FileRow
              key={file.node_id}
              file={file}
              ml={fileIndent}
              checked={selectedFileIds.has(file.node_id)}
              onToggle={onToggleFile}
            />
          ))}

          {node.children?.length === 0 && !node.files?.length && (
            <Text
              size="xs"
              c="dimmed"
              ml={fileIndent}
              py={3}
              style={{ fontStyle: "italic" }}
            >
              {t("explorer.noFolders")}
            </Text>
          )}

          {node.children?.map((child) => (
            <FolderTreeNode
              key={child.node_id}
              siteName={siteName}
              node={child}
              depth={depth + 1}
              selectedIds={selectedIds}
              onToggle={onToggle}
              onBulkToggle={onBulkToggle}
              selectedFileIds={selectedFileIds}
              onToggleFile={onToggleFile}
              onBulkToggleFiles={onBulkToggleFiles}
              onUpdate={onUpdate}
              onRegisterItems={onRegisterItems}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
