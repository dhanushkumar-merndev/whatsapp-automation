"use client";

import { createContext, useContext } from "react";
import type { NodeType } from "@/lib/engine/schema";

export interface MediaOption {
  id: string;
  name: string;
  kind: "image" | "document" | "video";
}

export interface CrmOption {
  id: string;
  name: string;
  enabled: boolean;
}

/** Canvas actions; absent in read-only diagrams. */
export interface EditorActions {
  /** Adds a new step after a node's output and connects it. */
  addAfter: (nodeId: string, handle: string, type: NodeType) => void;
  /** Inserts a new step in the middle of an existing connection. */
  insertOnEdge: (edgeId: string, type: NodeType) => void;
  duplicateNode: (nodeId: string) => void;
  deleteNode: (nodeId: string) => void;
}

export interface EditorContextValue {
  mediaNames: Record<string, string>;
  media: MediaOption[];
  crm: CrmOption[];
  actions: EditorActions | null;
}

export const EditorContext = createContext<EditorContextValue>({ mediaNames: {}, media: [], crm: [], actions: null });

export function useEditorContext() {
  return useContext(EditorContext);
}
