import React, { useState, useCallback, useEffect } from "react";
import { Box, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { BrowseResult, FileNodeBrief } from "@/api/client";
import {
  ColumnWidthContext,
  DEFAULT_COL_WIDTHS,
  DEFAULT_COL_ORDER,
  type ColWidths,
  type ColKey,
  type TreeNodeState,
  type FileTreeProps,
} from "./file-tree/ColumnContext";
import { TreeHeader } from "./file-tree/TreeHeader";
import { FileRow } from "./file-tree/FileRow";
import { FolderTreeNode, updateNode } from "./file-tree/FolderTreeNode";

export function FileTree({
  siteName,
  rootResult,
  selectedIds,
  onToggle,
  onBulkToggle,
  selectedFileIds,
  onToggleFile,
  onBulkToggleFiles,
  onRegisterItems,
}: FileTreeProps) {
  const [nodes, setNodes] = useState<TreeNodeState[]>(
    rootResult.folders.map((f) => ({ ...f, expanded: false, loading: false })),
  );
  const [rootFiles] = useState<FileNodeBrief[]>(rootResult.files);
  const [colWidths, setColWidths] = useState<ColWidths>(DEFAULT_COL_WIDTHS);
  const [colOrder, setColOrder] = useState<ColKey[]>(DEFAULT_COL_ORDER);
  const { t } = useTranslation();

  // Register root-level items with the parent on mount
  useEffect(() => {
    if (!onRegisterItems) return;
    const sizeMap = new Map<number, number>(
      rootResult.files.map((f) => [f.node_id, f.size_bytes ?? 0]),
    );
    const fileParMap = new Map<number, number>(
      rootResult.files.map((f) => [f.node_id, rootResult.current_node_id]),
    );
    const folderParMap = new Map<number, number>(
      rootResult.folders.map((f) => [f.node_id, rootResult.current_node_id]),
    );
    onRegisterItems(
      rootResult.folders.map((f) => f.node_id),
      rootResult.files.map((f) => f.node_id),
      sizeMap,
      fileParMap,
      folderParMap,
    );
  // Run only once on mount — rootResult is stable after site load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stable updater that always operates on fresh state (no stale closures)
  const handleUpdate = useCallback(
    (nodeId: number, patch: Partial<TreeNodeState>) => {
      setNodes((prev) => updateNode(prev, nodeId, patch));
    },
    [],
  );

  return (
    <ColumnWidthContext.Provider
      value={{ colWidths, setColWidths, colOrder, setColOrder }}
    >
      <Box>
        <TreeHeader />

        {rootFiles.map((file) => (
          <FileRow
            key={file.node_id}
            file={file}
            ml={28}
            checked={selectedFileIds.has(file.node_id)}
            onToggle={onToggleFile}
          />
        ))}

        {nodes.length === 0 && rootFiles.length === 0 && (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            {t("explorer.noFolders")}
          </Text>
        )}

        {nodes.map((node) => (
          <FolderTreeNode
            key={node.node_id}
            siteName={siteName}
            node={node}
            depth={0}
            selectedIds={selectedIds}
            onToggle={onToggle}
            onBulkToggle={onBulkToggle}
            selectedFileIds={selectedFileIds}
            onToggleFile={onToggleFile}
            onBulkToggleFiles={onBulkToggleFiles}
            onUpdate={handleUpdate}
            onRegisterItems={onRegisterItems}
          />
        ))}
      </Box>
    </ColumnWidthContext.Provider>
  );
}
