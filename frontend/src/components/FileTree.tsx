import React, {
  useState,
  useCallback,
  useContext,
  createContext,
  useRef,
  useEffect,
} from "react";
import {
  Box,
  Group,
  Text,
  Checkbox,
  ActionIcon,
  Loader,
  Tooltip,
} from "@mantine/core";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
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
import { api, BrowseResult, FolderNode, FileNodeBrief } from "@/api/client";
import { formatBytes, formatDate } from "@/utils";

interface TreeNodeState extends FolderNode {
  expanded: boolean;
  loading: boolean;
  children?: TreeNodeState[];
  files?: FileNodeBrief[];
}

interface FileTreeProps {
  siteName: string;
  rootResult: BrowseResult;
  selectedIds: Set<number>;
  onToggle: (nodeId: number, checked: boolean) => void;
  onBulkToggle: (nodeIds: number[], checked: boolean) => void;
  selectedFileIds: Set<number>;
  onToggleFile: (nodeId: number, checked: boolean) => void;
  onBulkToggleFiles: (fileIds: number[], checked: boolean) => void;
  /** Called whenever new items are loaded (root mount + each lazy expand). Parent accumulates. */
  onRegisterItems?: (
    folderIds: number[],
    fileIds: number[],
    fileSizeMap: Map<number, number>,
    fileParentMap: Map<number, number>,
    folderParentMap: Map<number, number>,
  ) => void;
}

// ---- Column resize + reorder context ----
const DEFAULT_COL_WIDTHS = { modifier: 120, modified: 145, size: 68 };
const DEFAULT_COL_ORDER: ColKey[] = ["modifier", "modified", "size"];
type ColKey = keyof typeof DEFAULT_COL_WIDTHS;

const COL_LABEL_KEY: Record<ColKey, string> = {
  modifier: "explorer.columns.modifier",
  modified: "explorer.columns.modified",
  size: "explorer.columns.size",
};
const COL_ALIGN: Record<ColKey, "left" | "right"> = {
  modifier: "right",
  modified: "left",
  size: "right",
};
const COL_MIN_WIDTH: Record<ColKey, number> = {
  modifier: 60,
  modified: 80,
  size: 48,
};

interface ColWidths {
  modifier: number;
  modified: number;
  size: number;
}
interface ColWidthCtx {
  colWidths: ColWidths;
  setColWidths: React.Dispatch<React.SetStateAction<ColWidths>>;
  colOrder: ColKey[];
  setColOrder: React.Dispatch<React.SetStateAction<ColKey[]>>;
}
const ColumnWidthContext = createContext<ColWidthCtx>({
  colWidths: DEFAULT_COL_WIDTHS,
  setColWidths: () => {},
  colOrder: DEFAULT_COL_ORDER,
  setColOrder: () => {},
});

function ResizeHandle({ col }: { col: ColKey }) {
  const { colWidths, setColWidths } = useContext(ColumnWidthContext);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = colWidths[col];
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        setColWidths((prev) => ({
          ...prev,
          [col]: Math.max(COL_MIN_WIDTH[col], startWidth + delta),
        }));
      };
      const onMouseUp = () => {
        setDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [col, colWidths, setColWidths],
  );

  return (
    <Box
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 8,
        cursor: "col-resize",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Box
        style={{
          width: 2,
          height: "100%",
          minHeight: 14,
          borderRadius: 1,
          background:
            hovered || dragging
              ? "var(--mantine-color-blue-5)"
              : "var(--mantine-color-default-border)",
          transition: "background 0.15s",
        }}
      />
    </Box>
  );
}

/** Recursively collect all loaded file node IDs from a folder and its descendants. */
function collectFileIds(node: TreeNodeState): number[] {
  const ids: number[] = (node.files ?? []).map((f) => f.node_id);
  for (const child of node.children ?? []) {
    ids.push(...collectFileIds(child));
  }
  return ids;
}

/** Recursively collect all loaded child folder node IDs from a folder's descendants. */
function collectFolderIds(node: TreeNodeState): number[] {
  const ids: number[] = [];
  for (const child of node.children ?? []) {
    ids.push(child.node_id);
    ids.push(...collectFolderIds(child));
  }
  return ids;
}

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

/** OneDrive-style file row with metadata columns and a selection checkbox. */
function FileRow({
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

/** Column header row — aligns with depth-0 folder rows. */
function TreeHeader() {
  const { t } = useTranslation();
  const { colWidths, colOrder, setColOrder } = useContext(ColumnWidthContext);
  const [dragOverCol, setDragOverCol] = useState<ColKey | null>(null);
  const dragSrcCol = useRef<ColKey | null>(null);

  return (
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
      {/* Spacer: chevron(22) + folder-checkbox(~28) + icon(20) + gap ≈ 74 */}
      <Box style={{ width: 74, flexShrink: 0 }} />
      <Text size="xs" c="dimmed" fw={600} style={{ flex: 1 }}>
        {t("explorer.columns.name")}
      </Text>
      {colOrder.map((col) => (
        <Box
          key={col}
          draggable
          onDragStart={(e) => {
            dragSrcCol.current = col;
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            dragSrcCol.current = null;
            setDragOverCol(null);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (dragSrcCol.current && dragSrcCol.current !== col)
              setDragOverCol(col);
          }}
          onDragLeave={() => setDragOverCol(null)}
          onDrop={(e) => {
            e.preventDefault();
            const src = dragSrcCol.current;
            if (!src || src === col) return;
            setColOrder((prev) => {
              const next = [...prev];
              const fromIdx = next.indexOf(src);
              const toIdx = next.indexOf(col);
              next.splice(fromIdx, 1);
              next.splice(toIdx, 0, src);
              return next;
            });
            setDragOverCol(null);
          }}
          style={{
            position: "relative",
            width: colWidths[col],
            flexShrink: 0,
            paddingRight: 8,
            cursor: "grab",
            borderLeft:
              dragOverCol === col
                ? "2px solid var(--mantine-color-blue-4)"
                : "2px solid transparent",
            transition: "border-color 0.1s",
          }}
        >
          <Text size="xs" c="dimmed" fw={600} ta={COL_ALIGN[col]} truncate>
            {t(COL_LABEL_KEY[col])}
          </Text>
          <ResizeHandle col={col} />
        </Box>
      ))}
    </Group>
  );
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

function FolderTreeNode({
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
    if (node.expanded) {
      onUpdate(node.node_id, { expanded: false });
      return;
    }
    if (node.children !== undefined) {
      // Already fetched — instant toggle
      onUpdate(node.node_id, { expanded: true });
      // If this folder is selected, cascade to already-loaded children
      if (selectedIds.has(node.node_id)) {
        const childFolderIds = node.children.map((c) => c.node_id);
        if (childFolderIds.length > 0) onBulkToggle(childFolderIds, true);
        const childFileIds = (node.files ?? []).map((f) => f.node_id);
        if (childFileIds.length > 0) onBulkToggleFiles(childFileIds, true);
      }
      return;
    }
    // First open: show spinner, fetch, THEN expand (seamless single-click UX)
    onUpdate(node.node_id, { loading: true });
    try {
      const result = await api.browse.get(siteName, node.node_id);
      const children: TreeNodeState[] = result.folders.map((f) => ({
        ...f,
        expanded: false,
        loading: false,
      }));
      // Expand and populate in one atomic update
      onUpdate(node.node_id, {
        expanded: true,
        loading: false,
        children,
        files: result.files,
      });
      // Notify parent about newly registered items (folders + files)
      if (onRegisterItems) {
        const sizeMap = new Map<number, number>(
          result.files.map((f) => [f.node_id, f.size_bytes ?? 0]),
        );
        const fileParMap = new Map<number, number>(
          result.files.map((f) => [f.node_id, node.node_id]),
        );
        const folderParMap = new Map<number, number>(
          children.map((c) => [c.node_id, node.node_id]),
        );
        onRegisterItems(
          children.map((c) => c.node_id),
          result.files.map((f) => f.node_id),
          sizeMap,
          fileParMap,
          folderParMap,
        );
      }
      // If this folder is selected, cascade selection to newly loaded children
      if (selectedIds.has(node.node_id)) {
        const childFolderIds = children.map((c) => c.node_id);
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
  // Indent offset for child files: align icon with folder name
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

        {/* Selection checkbox — also cascades to all loaded descendant folders and files */}
        <Checkbox
          size="sm"
          checked={isSelected}
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

function updateNode(
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
