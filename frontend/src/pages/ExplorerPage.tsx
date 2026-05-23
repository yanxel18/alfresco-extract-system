import { useState, useCallback, useDeferredValue, useRef, useMemo } from "react";
import {
  Stack,
  Title,
  Group,
  Button,
  Text,
  Paper,
  Skeleton,
  Alert,
  Badge,
  Divider,
  ActionIcon,
  Tooltip,
  Modal,
  Box,
  ScrollArea,
  TextInput,
  Loader,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckSquare,
  Square,
  Download,
  AlertCircle,
  FolderOpen,
  Search,
  X,
} from "lucide-react";
import { useBrowse, useSearch } from "@/hooks/useBrowse";
import { useCreateJob } from "@/hooks/useJobs";
import { api } from "@/api/client";
import { FileTree } from "@/components/FileTree";
import { SearchResultList } from "@/components/SearchResultList";
import { notifications } from "@mantine/notifications";
import { formatBytes } from "@/utils";

export function ExplorerPage() {
  const { t } = useTranslation();
  const { siteName } = useParams<{ siteName: string }>();
  const navigate = useNavigate();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectedFileIds, setSelectedFileIds] = useState<Set<number>>(
    new Set(),
  );
  const [excludedFileIds, setExcludedFileIds] = useState<Set<number>>(
    new Set(),
  );
  const [confirmOpened, { open: openConfirm, close: closeConfirm }] =
    useDisclosure();
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const createJob = useCreateJob();

  // Registry of all loaded nodes — built up as user expands folders
  const knownFolderIds = useRef<Set<number>>(new Set());
  const fileInfoMap = useRef<Map<number, number>>(new Map()); // nodeId → size_bytes
  const fileParentMapRef = useRef<Map<number, number>>(new Map()); // fileId → parentFolderId
  const folderParentMapRef = useRef<Map<number, number>>(new Map()); // folderId → parentFolderId
  const folderSizeCache = useRef<Map<number, number>>(new Map()); // folderId → recursive size bytes
  const [sizeVersion, setSizeVersion] = useState(0); // bumped whenever folderSizeCache changes

  const {
    data: root,
    isPending,
    isError,
  } = useBrowse(siteName ?? "", undefined);

  const isSearching = deferredQuery.trim().length >= 2;
  const { data: searchResults, isFetching: isSearchFetching } = useSearch(
    siteName ?? "",
    deferredQuery.trim(),
  );

  // Called by FileTree whenever new items become loaded (mount + each lazy expand)
  const handleRegisterItems = useCallback(
    (
      folderIds: number[],
      fileIds: number[],
      fileSizeMap: Map<number, number>,
      fileParentMap: Map<number, number>,
      folderParentMap: Map<number, number>,
    ) => {
      for (const id of folderIds) knownFolderIds.current.add(id);
      for (const [id, size] of fileSizeMap) fileInfoMap.current.set(id, size);
      for (const id of fileIds) {
        if (!fileInfoMap.current.has(id)) fileInfoMap.current.set(id, 0);
      }
      for (const [fileId, parentId] of fileParentMap) {
        fileParentMapRef.current.set(fileId, parentId);
      }
      for (const [folderId, parentId] of folderParentMap) {
        folderParentMapRef.current.set(folderId, parentId);
      }
    },
    [],
  );

  const handleToggle = useCallback(
    (nodeId: number, checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (checked) next.add(nodeId);
        else next.delete(nodeId);
        return next;
      });
      if (checked && siteName) {
        // Fetch recursive size for this folder from the backend
        api.browse
          .folderSize(siteName, [nodeId])
          .then((results) => {
            if (results.length > 0) {
              folderSizeCache.current.set(nodeId, results[0].total_size_bytes);
              setSizeVersion((v) => v + 1);
            }
          })
          .catch(() => {
            folderSizeCache.current.set(nodeId, 0);
          });
      } else if (!checked) {
        folderSizeCache.current.delete(nodeId);
        setSizeVersion((v) => v + 1);
      }
    },
    [siteName],
  );

  const handleBulkToggle = useCallback(
    (nodeIds: number[], checked: boolean) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of nodeIds) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [],
  );

  const handleToggleFile = useCallback((nodeId: number, checked: boolean) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(nodeId);
      else next.delete(nodeId);
      return next;
    });
    // Track explicit user exclusions: unchecked = excluded, re-checked = not excluded
    setExcludedFileIds((prev) => {
      const next = new Set(prev);
      if (checked) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleBulkToggleFiles = useCallback(
    (fileIds: number[], checked: boolean) => {
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        for (const id of fileIds) {
          if (checked) next.add(id);
          else next.delete(id);
        }
        return next;
      });
      // When a folder is deselected (bulk uncheck), clear those files from excluded
      // since the whole folder is no longer selected — exclusion is irrelevant.
      if (!checked) {
        setExcludedFileIds((prev) => {
          const next = new Set(prev);
          for (const id of fileIds) next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  // Select All: covers every loaded folder AND file across the full tree
  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(knownFolderIds.current));
    setSelectedFileIds(new Set(fileInfoMap.current.keys()));
    setExcludedFileIds(new Set());
    if (!siteName) return;
    // Batch-fetch sizes only for root-level folders (parent not in knownFolderIds)
    // to avoid double-counting parent + child recursive totals.
    const rootFolderIds = [...knownFolderIds.current].filter(
      (id) =>
        !knownFolderIds.current.has(folderParentMapRef.current.get(id) ?? -1),
    );
    if (rootFolderIds.length === 0) return;
    api.browse
      .folderSize(siteName, rootFolderIds)
      .then((results) => {
        for (const r of results) {
          folderSizeCache.current.set(r.node_id, r.total_size_bytes);
        }
        setSizeVersion((v) => v + 1);
      })
      .catch(() => {});
  }, [siteName]);

  // Deselect All: clear everything; registry (knownFolderIds, fileInfoMap, etc.) is preserved
  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedFileIds(new Set());
    setExcludedFileIds(new Set());
    folderSizeCache.current.clear();
    setSizeVersion((v) => v + 1);
  }, []);

  const handleStartExtraction = async () => {
    if (!siteName) return;
    const folderIds = Array.from(selectedIds);
    const fileIds = Array.from(selectedFileIds);
    const excludedIds = Array.from(excludedFileIds);
    try {
      await createJob.mutateAsync({
        site_name: siteName,
        selected_folder_node_ids: folderIds,
        selected_file_node_ids: fileIds,
        excluded_file_node_ids: excludedIds,
      });
      notifications.show({
        title: t("notifications.jobCreated", { site: siteName }),
        message: "",
        color: "green",
      });
      closeConfirm();
      navigate("/jobs");
    } catch (e: any) {
      notifications.show({
        title: t("notifications.errorCreating"),
        message: e.message,
        color: "red",
      });
    }
  };

  const selectedCount = selectedIds.size;
  const selectedFileCount = selectedFileIds.size;
  const hasSelection = selectedCount > 0 || selectedFileCount > 0;

  // Compute total selected size from folder cache + loose files, avoiding double-counting.
  // sizeVersion is a dependency to force re-computation when folderSizeCache (a ref) changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const totalSelectedSize = useMemo(() => {
    let total = 0;
    // Sum folder cache — skip entries whose parent is also cached+selected (avoids double-count)
    for (const [folderId, size] of folderSizeCache.current) {
      if (!selectedIds.has(folderId)) continue;
      const parentId = folderParentMapRef.current.get(folderId);
      if (
        parentId !== undefined &&
        folderSizeCache.current.has(parentId) &&
        selectedIds.has(parentId)
      )
        continue;
      total += size;
    }
    // Subtract excluded files whose parent folder is selected (they're in folder total)
    for (const fileId of excludedFileIds) {
      const parentId = fileParentMapRef.current.get(fileId);
      if (parentId !== undefined && selectedIds.has(parentId)) {
        total -= fileInfoMap.current.get(fileId) ?? 0;
      }
    }
    // Add loose files (selected files whose parent folder is NOT selected)
    for (const fileId of selectedFileIds) {
      const parentId = fileParentMapRef.current.get(fileId);
      if (parentId === undefined || !selectedIds.has(parentId)) {
        total += fileInfoMap.current.get(fileId) ?? 0;
      }
    }
    return Math.max(0, total);
  // sizeVersion triggers re-run when folderSizeCache ref changes
  }, [selectedIds, selectedFileIds, excludedFileIds, sizeVersion]);

  return (
    <Stack gap="lg">
      {/* Header */}
      <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
        <Group gap="sm">
          <ActionIcon variant="subtle" onClick={() => navigate("/sites")}>
            <ArrowLeft size={18} />
          </ActionIcon>
          <div>
            <Title order={2}>{t("explorer.title")}</Title>
            <Group gap={6} mt={2}>
              <FolderOpen size={14} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed">
                {siteName}
              </Text>
            </Group>
          </div>
        </Group>

        <Group gap="xs">
          {selectedCount > 0 && (
            <Badge size="md" color="brand" variant="filled">
              {t("explorer.selectedFolders", { count: selectedCount })}
            </Badge>
          )}
          {selectedFileCount > 0 && (
            <Badge size="md" color="teal" variant="filled">
              {t("explorer.selectedFiles", { count: selectedFileCount })}
            </Badge>
          )}
          {totalSelectedSize > 0 && (
            <Tooltip label={t("explorer.selectedSizeTooltip")} withArrow>
              <Badge size="md" color="violet" variant="light">
                {formatBytes(totalSelectedSize)}
              </Badge>
            </Tooltip>
          )}
          <Button
            variant="default"
            size="sm"
            leftSection={<CheckSquare size={14} />}
            onClick={handleSelectAll}
            disabled={isPending}
          >
            {t("explorer.selectAll")}
          </Button>
          <Button
            variant="default"
            size="sm"
            leftSection={<Square size={14} />}
            onClick={handleDeselectAll}
            disabled={!hasSelection}
          >
            {t("explorer.deselectAll")}
          </Button>
          <Button
            size="sm"
            leftSection={<Download size={14} />}
            onClick={openConfirm}
            disabled={isPending}
          >
            {hasSelection
              ? t("explorer.startExtraction")
              : t("explorer.extractAll")}
          </Button>
        </Group>
      </Group>

      {/* Search bar */}
      <TextInput
        placeholder={t("explorer.searchPlaceholder")}
        leftSection={
          isSearchFetching ? <Loader size={14} /> : <Search size={14} />
        }
        rightSection={
          searchQuery ? (
            <ActionIcon
              variant="subtle"
              size="sm"
              onClick={() => setSearchQuery("")}
            >
              <X size={13} />
            </ActionIcon>
          ) : null
        }
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.currentTarget.value)}
        disabled={isPending}
      />

      <Divider />

      {/* Tree / Search results area */}
      {isError && (
        <Alert icon={<AlertCircle size={16} />} color="red">
          {t("common.error")}
        </Alert>
      )}

      {isPending && (
        <Stack gap="xs">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} height={32} radius="sm" />
          ))}
        </Stack>
      )}

      {root && (
        <Paper withBorder p="md">
          {isSearching ? (
            /* Search results panel */
            <Box>
              <Text size="xs" c="dimmed" mb="xs" fw={500}>
                {searchResults
                  ? t("explorer.searchResults", {
                      count: searchResults.length,
                    })
                  : t("explorer.searchMinChars")}
              </Text>
              <ScrollArea.Autosize mah="60vh">
                <Box pr="sm">
                  <SearchResultList
                    results={searchResults ?? []}
                    isLoading={isSearchFetching && !searchResults}
                    selectedFileIds={selectedFileIds}
                    onToggleFile={handleToggleFile}
                  />
                </Box>
              </ScrollArea.Autosize>
            </Box>
          ) : (
            /* Normal folder tree */
            <Box>
              <Text size="xs" c="dimmed" mb="xs" fw={500}>
                {t("explorer.root")}
              </Text>
              <ScrollArea.Autosize mah="60vh">
                <Box pr="sm">
                  <FileTree
                    siteName={siteName ?? ""}
                    rootResult={root}
                    selectedIds={selectedIds}
                    onToggle={handleToggle}
                    onBulkToggle={handleBulkToggle}
                    selectedFileIds={selectedFileIds}
                    onToggleFile={handleToggleFile}
                    onBulkToggleFiles={handleBulkToggleFiles}
                    onRegisterItems={handleRegisterItems}
                  />
                </Box>
              </ScrollArea.Autosize>
            </Box>
          )}
        </Paper>
      )}

      {/* Confirm extraction modal */}
      <Modal
        opened={confirmOpened}
        onClose={closeConfirm}
        title={t("explorer.confirmExtract")}
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            {t("explorer.confirmExtractMsg", { site: siteName })}
          </Text>
          <Alert color={hasSelection ? "brand" : "orange"} variant="light">
            {selectedCount > 0 && selectedFileCount > 0
              ? t("explorer.confirmExtractMixed", {
                  folders: selectedCount,
                  files: selectedFileCount,
                })
              : selectedCount > 0
                ? t("explorer.confirmExtractSelected", { count: selectedCount })
                : selectedFileCount > 0
                  ? t("explorer.confirmExtractFiles", {
                      count: selectedFileCount,
                    })
                  : t("explorer.confirmExtractAll")}
          </Alert>
          {totalSelectedSize > 0 && (
            <Text size="sm" c="dimmed">
              {t("explorer.selectedSizeTooltip")}: <strong>{formatBytes(totalSelectedSize)}</strong>
            </Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={closeConfirm}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={createJob.isPending}
              onClick={handleStartExtraction}
            >
              {t("explorer.confirmExtract")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
