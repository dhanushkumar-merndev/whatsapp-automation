"use client";

import { createContext, useContext } from "react";

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

export interface EditorContextValue {
  mediaNames: Record<string, string>;
  media: MediaOption[];
  crm: CrmOption[];
}

export const EditorContext = createContext<EditorContextValue>({ mediaNames: {}, media: [], crm: [] });

export function useEditorContext() {
  return useContext(EditorContext);
}
