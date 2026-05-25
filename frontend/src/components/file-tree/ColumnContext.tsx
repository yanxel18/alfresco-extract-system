import React, { createContext } from "react";
import type { BrowseResult, FolderNode, FileNodeBrief } from "@/api/client";

// ---- Column resize + reorder ----
export const DEFAULT_COL_WIDTHS = { modifier: 120, modified: 145, size: 68 };
export const DEFAULT_COL_ORDER: ColKey[] = ["modifier", "modified", "size"];
export type ColKey = keyof typeof DEFAULT_COL_WIDTHS;

export const COL_LABEL_KEY: Record<ColKey, string> = {
  modifier: "explorer.columns.modifier",
  modified: "explorer.columns.modified",
  size: "explorer.columns.size",
};
export const COL_ALIGN: Record<ColKey, "left" | "right"> = {
  modifier: "right",
  modified: "left",
  size: "right",
};
export const COL_MIN_WIDTH: Record<ColKey, number> = {
  modifier: 60,
  modified: 80,
  size: 48,
};

export interface ColWidths {
  modifier: number;
  modified: number;
  size: number;
}
export interface ColWidthCtx {
  colWidths: ColWidths;
  setColWidths: React.Dispatch<React.SetStateAction<ColWidths>>;
  colOrder: ColKey[];
  setColOrder: React.Dispatch<React.SetStateAction<ColKey[]>>;
}
export const ColumnWidthContext = createContext<ColWidthCtx>({
  colWidths: DEFAULT_COL_WIDTHS,
  setColWidths: () => {},
  colOrder: DEFAULT_COL_ORDER,
  setColOrder: () => {},
});

// ---- Shared tree types ----
export interface TreeNodeState extends FolderNode {
  expanded: boolean;
  loading: boolean;
  children?: TreeNodeState[];
  files?: FileNodeBrief[];
}

export interface FileTreeProps {
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
