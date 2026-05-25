import React, { useState, useCallback, useContext, useRef } from "react";
import { Box, Group, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import {
  ColumnWidthContext,
  COL_ALIGN,
  COL_LABEL_KEY,
  COL_MIN_WIDTH,
  type ColKey,
} from "./ColumnContext";

/** Drag handle on the right edge of a column header cell. */
export function ResizeHandle({ col }: { col: ColKey }) {
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

/** Column header row — aligns with depth-0 folder rows. */
export function TreeHeader() {
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
