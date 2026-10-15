"use client";

import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type IsValidConnection,
  type OnConnectEnd,
} from "@xyflow/react";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  Check,
  Copy,
  FileJson,
  FlaskConical,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Redo2,
  Rocket,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/common/status-badge";
import { useConfirm } from "@/components/common/confirm-dialog";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import type { FlowDefinition, NodeType } from "@/lib/engine/schema";
import { validateFlow } from "@/lib/engine/validate-graph";
import type { AppSettings } from "@/lib/settings/schema";
import { cn } from "@/lib/utils";
import { duplicateFlowAction, saveDraftAction, setFlowStatusAction, updateFlowDetailsAction } from "@/app/(dashboard)/flows/actions";
import {
  addAfter as addAfterModel,
  autoLayout,
  connectEdge,
  createNode,
  EDGE_TYPE,
  findFreeSpot,
  insertBetween,
  makeEdge,
  newNodeId,
  NODE_HEIGHT,
  NODE_WIDTH,
  toDefinition,
  toEditor,
  type EditorEdge,
  type EditorNode,
} from "./model";
import { FlowNode } from "./flow-node";
import { InsertEdge } from "./insert-edge";
import { DRAG_MIME, Palette } from "./palette";
import { PropertiesPanel } from "./properties-panel";
import { FlowChecklist } from "./flow-checklist";
import { ValidationList } from "./validation-list";
import { Simulator } from "./simulator";
import { PublishDialog } from "./publish-dialog";
import { StepPicker } from "./step-picker";
import { VersionHistory, type VersionItem } from "./version-history";
import { EditorContext, type CrmOption, type EditorActions, type MediaOption } from "./editor-context";
import { ImportFlowDialog } from "@/components/flows/import-flow-dialog";
import { exportFlowJson } from "@/lib/flows/import";

export interface FlowEditorProps {
  flow: {
    id: string;
    name: string;
    description: string | null;
    status: "draft" | "testing" | "active" | "paused" | "archived";
    draftDefinition: FlowDefinition;
    draftUpdatedAt: string;
    publishedVersionId: string | null;
    liveVersion: number | null;
  };
  versions: VersionItem[];
  media: MediaOption[];
  crm: CrmOption[];
  settings: AppSettings;
}

const nodeTypes = { flowNode: FlowNode };
const STATUS_TOAST = {
  active: "Now live for all customers",
  testing: "Now used for test numbers",
  paused: "Workflow paused",
  archived: "Workflow archived",
} as const;
const edgeTypes = { [EDGE_TYPE]: InsertEdge };
/** Autosave waits this long after the last change (drafts are rate limited per minute). */
const AUTOSAVE_MS = 2000;

type PanelTab = "edit" | "issues" | "test";

function stripForKey(def: FlowDefinition, withPositions: boolean) {
  return JSON.stringify(withPositions ? def : { nodes: def.nodes.map((n) => ({ ...n, position: undefined })), edges: def.edges });
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ flow, versions, media, crm, settings }: FlowEditorProps) {
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const confirm = useConfirm();
  const rf = useReactFlow<EditorNode, EditorEdge>();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const canvasRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => toEditor(flow.draftDefinition), [flow.draftDefinition]);
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>(initial.edges);
  const [name, setName] = useState(flow.name);
  const [tab, setTab] = useState<PanelTab>("edit");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [path, setPath] = useState<{ visited: string[]; current: string | null } | null>(null);
  const [tested, setTested] = useState(false);
  const [dropPicker, setDropPicker] = useState<{ left: number; top: number; flow: { x: number; y: number }; source: string; handle: string } | null>(null);
  const [statusPending, startStatus] = useTransition();
  const clipboard = useRef<{ nodes: EditorNode[]; edges: EditorEdge[] } | null>(null);

  // Latest graph for callbacks that must stay stable (canvas actions, autosave).
  const graph = useRef({ nodes, edges });
  useLayoutEffect(() => {
    graph.current = { nodes, edges };
  }, [nodes, edges]);

  const initialKey = useMemo(() => stripForKey(flow.draftDefinition, true), [flow.draftDefinition]);
  const [savedKey, setSavedKey] = useState(initialKey);
  const savedKeyRef = useRef(initialKey);
  /** Set before an intentional reload so the unsaved-changes prompt is skipped. */
  const skipUnloadGuard = useRef(false);

  const definition = useMemo(() => toDefinition(nodes, edges), [nodes, edges]);
  const fullKey = useMemo(() => stripForKey(definition, true), [definition]);
  const logicalKey = useMemo(() => stripForKey(definition, false), [definition]);
  // Recompute validation only when the logic changes (not while dragging).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const logicalDefinition = useMemo(() => definition, [logicalKey]);
  const validation = useMemo(() => validateFlow(logicalDefinition), [logicalDefinition]);
  const dirty = fullKey !== savedKey;

  // --- Autosave -------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftAt = useRef<string | null>(flow.draftUpdatedAt);
  const inflight = useRef<Promise<boolean> | null>(null);

  /** Saves the newest graph; concurrent calls queue behind the running save. */
  const save = useCallback(async (): Promise<boolean> => {
    while (inflight.current) await inflight.current;
    const def = toDefinition(graph.current.nodes, graph.current.edges);
    const key = stripForKey(def, true);
    if (key === savedKeyRef.current) return true;
    const run = (async () => {
      setSaving(true);
      try {
        const r = await saveDraftAction({ flowId: flow.id, definition: def, expectedDraftUpdatedAt: draftAt.current });
        if (!r.ok) {
          setSaveError(r.error);
          return false;
        }
        draftAt.current = r.data!.draftUpdatedAt;
        savedKeyRef.current = key;
        setSavedKey(key);
        setSaveError(null);
        return true;
      } catch {
        setSaveError("Couldn't reach the server.");
        return false;
      } finally {
        setSaving(false);
      }
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      if (inflight.current === run) inflight.current = null;
    }
  }, [flow.id]);

  useEffect(() => {
    // After a failed save, wait for the user to retry instead of hammering the server.
    if (!dirty || saveError) return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [fullKey, dirty, saveError, save]);

  useEffect(() => {
    if (!saveError) return;
    const conflict = saveError.includes("another window");
    toast.error(conflict ? "This flow was changed somewhere else" : "Couldn't save your changes", {
      id: "flow-save",
      description: conflict ? "Reload to get the latest version. Your unsaved edits here will be lost." : saveError,
      duration: Infinity,
      action: conflict
        ? {
            label: "Reload",
            onClick: () => {
              skipUnloadGuard.current = true;
              window.location.reload();
            },
          }
        : { label: "Retry", onClick: () => setSaveError(null) },
    });
    return () => void toast.dismiss("flow-save");
  }, [saveError]);

  // --- Undo / redo ------------------------------------------------------------
  const history = useRef<{ past: string[]; future: string[]; committed: string }>({ past: [], future: [], committed: initialKey });
  useEffect(() => {
    const t = setTimeout(() => {
      const h = history.current;
      if (fullKey === h.committed) return;
      history.current = { past: [...h.past, h.committed].slice(-100), future: [], committed: fullKey };
    }, 350);
    return () => clearTimeout(t);
  }, [fullKey]);

  const applySnapshot = useCallback(
    (key: string) => {
      const next = toEditor(JSON.parse(key) as FlowDefinition);
      setNodes(next.nodes);
      setEdges(next.edges);
    },
    [setNodes, setEdges],
  );
  const undo = useCallback(() => {
    const { past, future, committed } = history.current;
    const prev = past.at(-1);
    if (prev === undefined) return;
    history.current = { past: past.slice(0, -1), future: [...future, committed], committed: prev };
    applySnapshot(prev);
  }, [applySnapshot]);
  const redo = useCallback(() => {
    const { past, future, committed } = history.current;
    const next = future.at(-1);
    if (next === undefined) return;
    history.current = { past: [...past, committed], future: future.slice(0, -1), committed: next };
    applySnapshot(next);
  }, [applySnapshot]);

  // --- Graph editing --------------------------------------------------------------
  const hasTrigger = nodes.some((n) => n.data.nodeType === "trigger");

  const isValidConnection: IsValidConnection<EditorEdge> = useCallback(
    (c) => {
      if (c.source === c.target) return false;
      const target = graph.current.nodes.find((n) => n.id === c.target);
      return Boolean(target && NODE_REGISTRY[target.data.nodeType].hasInput);
    },
    [],
  );

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => connectEdge(eds, c.source, c.sourceHandle ?? "out", c.target)),
    [setEdges],
  );

  /** Pans so a newly placed step is visible, keeping the zoom level. */
  const reveal = useCallback(
    (p: { x: number; y: number }) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tl = rf.flowToScreenPosition(p);
      const br = rf.flowToScreenPosition({ x: p.x + NODE_WIDTH, y: p.y + NODE_HEIGHT + 60 });
      if (tl.x < rect.left || tl.y < rect.top || br.x > rect.right || br.y > rect.bottom) {
        rf.setCenter(p.x + NODE_WIDTH / 2, p.y + NODE_HEIGHT / 2, { zoom: rf.getZoom(), duration: 300 });
      }
    },
    [rf],
  );

  const afterAdd = useCallback(
    (r: { nodes: EditorNode[]; edges: EditorEdge[]; node: EditorNode }) => {
      setNodes(r.nodes);
      setEdges(r.edges.map((e) => ({ ...e, selected: false })));
      setTab("edit");
      setTimeout(() => reveal(r.node.position), 30);
    },
    [setNodes, setEdges, reveal],
  );

  const addNodeAt = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      if (NODE_REGISTRY[type].singleton && graph.current.nodes.some((n) => n.data.nodeType === type)) {
        toast.error("A flow can only have one start step.");
        return null;
      }
      const node = createNode(type, position);
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), node]);
      setTab("edit");
      return node;
    },
    [setNodes],
  );

  const deleteNodes = useCallback(
    (ids: string[]) => {
      setNodes((nds) => nds.filter((n) => !ids.includes(n.id)));
      setEdges((eds) => eds.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)));
    },
    [setNodes, setEdges],
  );

  const cloneInto = useCallback(
    (source: { nodes: EditorNode[]; edges: EditorEdge[] }, offset: number) => {
      const map = new Map<string, string>();
      const copies = source.nodes
        .filter((n) => !NODE_REGISTRY[n.data.nodeType].singleton)
        .map((n) => {
          const id = newNodeId(n.data.nodeType);
          map.set(n.id, id);
          return {
            ...n,
            id,
            selected: true,
            position: { x: n.position.x + offset, y: n.position.y + offset },
            data: structuredClone({ nodeType: n.data.nodeType, label: n.data.label, config: n.data.config }),
          } as EditorNode;
        });
      const copiedEdges = source.edges
        .filter((e) => map.has(e.source) && map.has(e.target))
        .map((e) => makeEdge(map.get(e.source)!, e.sourceHandle ?? "out", map.get(e.target)!));
      if (!copies.length) return;
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...copies]);
      setEdges((eds) => [...eds, ...copiedEdges]);
    },
    [setNodes, setEdges],
  );

  const actions = useMemo<EditorActions>(
    () => ({
      addAfter: (nodeId, handle, type) => {
        const r = addAfterModel(graph.current.nodes, graph.current.edges, nodeId, handle, type);
        if (r) afterAdd(r);
      },
      insertOnEdge: (edgeId, type) => {
        const r = insertBetween(graph.current.nodes, graph.current.edges, edgeId, type);
        if (r) afterAdd(r);
      },
      duplicateNode: (nodeId) => {
        const n = graph.current.nodes.find((x) => x.id === nodeId);
        if (n) cloneInto({ nodes: [n], edges: [] }, 40);
      },
      deleteNode: (nodeId) => deleteNodes([nodeId]),
    }),
    [afterAdd, cloneInto, deleteNodes],
  );

  /** Palette click: continue from the selected step when it has a free output, else drop near the centre. */
  const addFromPalette = useCallback(
    (type: NodeType) => {
      const { nodes: nds, edges: eds } = graph.current;
      const sel = nds.filter((n) => n.selected);
      if (NODE_REGISTRY[type].hasInput && sel.length === 1) {
        const used = new Set(eds.filter((e) => e.source === sel[0].id).map((e) => e.sourceHandle ?? "out"));
        const free = NODE_REGISTRY[sel[0].data.nodeType].outputs.find((o) => !used.has(o.id));
        if (free) return actions.addAfter(sel[0].id, free.id, type);
      }
      const rect = canvasRef.current?.getBoundingClientRect();
      const center = rf.screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2,
        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2,
      });
      const node = addNodeAt(type, findFreeSpot({ x: center.x - NODE_WIDTH / 2, y: center.y - NODE_HEIGHT / 2 }, nds));
      if (node) setTimeout(() => reveal(node.position), 30);
    },
    [actions, addNodeAt, rf, reveal],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DRAG_MIME) as NodeType;
      if (!type || !(type in NODE_REGISTRY)) return;
      addNodeAt(type, rf.screenToFlowPosition({ x: e.clientX - NODE_WIDTH / 2, y: e.clientY - 30 }));
    },
    [rf, addNodeAt],
  );

  /** Dropping a connection on empty canvas offers a step picker right there. */
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || state.fromHandle?.type !== "source") return;
      if (!(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) return;
      const point = "changedTouches" in event ? event.changedTouches[0] : event;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropPicker({
        left: point.clientX - rect.left,
        top: point.clientY - rect.top,
        flow: rf.screenToFlowPosition({ x: point.clientX, y: point.clientY }),
        source: state.fromNode.id,
        handle: state.fromHandle.id ?? "out",
      });
    },
    [rf],
  );

  const pickAtDrop = (type: NodeType) => {
    if (!dropPicker) return;
    const node = createNode(type, { x: dropPicker.flow.x - NODE_WIDTH / 2, y: dropPicker.flow.y });
    setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), node]);
    setEdges((eds) => connectEdge(eds, dropPicker.source, dropPicker.handle, node.id));
    setTab("edit");
    setDropPicker(null);
  };

  const selectedNodes = nodes.filter((n) => n.selected);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null;

  const updateNode = useCallback(
    (id: string, patch: Partial<EditorNode["data"]>) =>
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
    [setNodes],
  );

  const copySelection = useCallback(() => {
    const { nodes: nds, edges: eds } = graph.current;
    const sel = nds.filter((n) => n.selected);
    if (!sel.length) return;
    const ids = new Set(sel.map((n) => n.id));
    clipboard.current = { nodes: sel, edges: eds.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    toast.message(`Copied ${sel.length} step${sel.length === 1 ? "" : "s"}`);
  }, []);

  const runLayout = useCallback(() => {
    setNodes((nds) => autoLayout(nds, graph.current.edges));
    setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50);
  }, [setNodes, rf]);

  // --- Status / name ------------------------------------------------------------------
  const changeStatus = (status: "active" | "testing" | "paused" | "archived") =>
    startStatus(async () => {
      if (
        status === "archived" &&
        !(await confirm({
          title: "Archive this workflow?",
          description: "It stops, including chats in progress, and is hidden from the list. You can still find it under “Show archived”.",
          confirmLabel: "Archive",
          destructive: true,
        }))
      ) {
        return;
      }
      const r = await setFlowStatusAction({ flowId: flow.id, status });
      if (!r.ok) toast.error(r.error);
      else {
        const stopped = (r.data as { stopped?: number } | undefined)?.stopped ?? 0;
        toast.success(`${STATUS_TOAST[status]}${stopped ? ` · ${stopped} open chat(s) stopped` : ""}`);
        router.refresh();
      }
    });

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === flow.name) {
      setName(flow.name);
      return;
    }
    const r = await updateFlowDetailsAction({ flowId: flow.id, name: trimmed, description: flow.description ?? "" });
    if (!r.ok) {
      toast.error(r.error);
      setName(flow.name);
    } else router.refresh();
  };

  const leave = async (e: React.MouseEvent) => {
    if (!dirty && !inflight.current) return;
    e.preventDefault();
    if (
      (await save()) ||
      (await confirm({ title: "Leave without saving?", description: "Your latest changes couldn't be saved.", confirmLabel: "Leave", destructive: true }))
    ) {
      skipUnloadGuard.current = true;
      router.push("/flows");
    }
  };

  // --- Keyboard shortcuts & unsaved-changes guard -------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, [contenteditable=true], [role=combobox], [cmdk-root]");
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        setSaveError(null);
        void save().then((ok) => ok && toast.success("Saved", { id: "flow-saved", duration: 1200 }));
        return;
      }
      if (typing) return;
      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && key === "c") {
        copySelection();
      } else if (mod && key === "v") {
        if (clipboard.current) {
          e.preventDefault();
          cloneInto(clipboard.current, 60);
        }
      } else if (mod && key === "d") {
        e.preventDefault();
        const { nodes: nds, edges: eds } = graph.current;
        const sel = nds.filter((n) => n.selected);
        const ids = new Set(sel.map((n) => n.id));
        cloneInto({ nodes: sel, edges: eds.filter((x) => ids.has(x.source) && ids.has(x.target)) }, 40);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, copySelection, cloneInto]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (skipUnloadGuard.current || (!dirty && !inflight.current)) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // --- Rendering -------------------------------------------------------------------------------
  const issuesByNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of [...validation.errors, ...validation.warnings]) if (i.nodeId) m.set(i.nodeId, (m.get(i.nodeId) ?? 0) + 1);
    return m;
  }, [validation]);

  const connectedBySource = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of edges) m.set(e.source, [...(m.get(e.source) ?? []), e.sourceHandle ?? "out"]);
    return m;
  }, [edges]);

  // Reuse decorated node objects while nothing about them changed, so dragging one node doesn't re-render all.
  const [decorated] = useState(() => new WeakMap<EditorNode, { key: string; node: EditorNode }>());
  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const highlight: EditorNode["data"]["highlight"] = path ? (path.current === n.id ? "current" : path.visited.includes(n.id) ? "visited" : null) : null;
        const issues = issuesByNode.get(n.id) ?? 0;
        const connected = connectedBySource.get(n.id) ?? [];
        const key = `${highlight}|${issues}|${connected.join(",")}`;
        const hit = decorated.get(n);
        if (hit?.key === key) return hit.node;
        const node = { ...n, data: { ...n.data, highlight, issues, connected } } as EditorNode;
        decorated.set(n, { key, node });
        return node;
      }),
    [nodes, path, issuesByNode, connectedBySource, decorated],
  );

  const ctx = useMemo(
    () => ({ media, crm, mediaNames: Object.fromEntries(media.map((m) => [m.id, m.name])), actions }),
    [media, crm, actions],
  );

  const selectNode = (id: string) => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
    const n = graph.current.nodes.find((x) => x.id === id);
    if (n) rf.setCenter(n.position.x + NODE_WIDTH / 2, n.position.y + NODE_HEIGHT / 2, { zoom: Math.max(rf.getZoom(), 0.85), duration: 300 });
    setTab("edit");
  };

  const openTab = (t: PanelTab) => {
    setTab(t);
    if (!isDesktop) setSheetOpen(true);
  };

  const onSimPath = useCallback((p: { visited: string[]; current: string | null } | null) => {
    setPath(p);
    if (p) setTested(true);
  }, []);

  const openPublish = async () => {
    setSaveError(null);
    if (dirty && !(await save())) return;
    setPublishOpen(true);
  };

  const errorCount = validation.errors.length;
  const issuesCount = errorCount + validation.warnings.length;

  const saveStatus = saveError ? (
    <button type="button" onClick={() => setSaveError(null)} className="inline-flex items-center gap-1 text-xs text-destructive hover:underline">
      <AlertCircle className="size-3.5" /> Not saved · Retry
    </button>
  ) : saving || dirty ? (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> Saving…
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Check className="size-3.5" /> Saved
    </span>
  );

  const panel = (
    <Tabs value={tab} onValueChange={(v) => setTab(v as PanelTab)} className="flex min-h-0 flex-1 flex-col gap-0">
      <TabsList className="m-3 mb-1 grid w-auto grid-cols-3">
        <TabsTrigger value="edit">Edit</TabsTrigger>
        <TabsTrigger value="issues">
          Issues
          {issuesCount > 0 && (
            <span className={cn("ml-1 rounded-full px-1.5 text-[10px] tabular-nums", errorCount ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning")}>
              {issuesCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="test">Test</TabsTrigger>
      </TabsList>
      <TabsContent value="edit" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          {selected ? (
            <PropertiesPanel
              node={selected}
              definition={logicalDefinition}
              issues={[...validation.errors, ...validation.warnings].filter((i) => i.nodeId === selected.id)}
              onChange={(config) => updateNode(selected.id, { config })}
              onLabel={(label) => updateNode(selected.id, { label })}
              onDelete={() => deleteNodes([selected.id])}
              onDuplicate={() => cloneInto({ nodes: [selected], edges: [] }, 40)}
            />
          ) : selectedNodes.length > 1 ? (
            <div className="space-y-3 p-4">
              <div className="text-[15px] font-semibold">{selectedNodes.length} steps selected</div>
              <p className="text-xs text-muted-foreground">Drag to move them together, or copy (Ctrl C) and paste (Ctrl V) them as a group.</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => cloneInto({ nodes: selectedNodes, edges }, 40)}>
                  <Copy /> Duplicate
                </Button>
                <Button variant="destructive" size="sm" onClick={() => deleteNodes(selectedNodes.map((n) => n.id))}>
                  <Trash2 /> Delete
                </Button>
              </div>
            </div>
          ) : (
            <FlowChecklist definition={logicalDefinition} validation={validation} tested={tested} onSelect={selectNode} onTest={() => openTab("test")} />
          )}
        </ScrollArea>
      </TabsContent>
      <TabsContent value="issues" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <ValidationList validation={validation} onSelect={selectNode} />
        </ScrollArea>
      </TabsContent>
      <TabsContent value="test" className="min-h-0 flex-1">
        <Simulator definition={logicalDefinition} settings={settings} media={media} onPath={onSimPath} />
      </TabsContent>
    </Tabs>
  );

  return (
    <EditorContext.Provider value={ctx}>
      <div data-full-bleed className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
        {/* Toolbar */}
        <div className="flex items-center gap-1.5 border-b bg-background px-2 py-2 sm:px-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/flows" aria-label="Back to flows" onClick={leave}>
              <ArrowLeft />
            </Link>
          </Button>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-8 w-36 min-w-0 rounded-lg border-transparent px-2 text-sm font-medium shadow-none hover:border-input sm:w-56"
            aria-label="Flow name"
          />
          <StatusBadge status={flow.status} className="hidden sm:inline-flex" />
          {flow.liveVersion && <span className="hidden text-xs text-muted-foreground md:inline">v{flow.liveVersion} live</span>}
          <div className="ml-1 hidden sm:block">{saveStatus}</div>
          <div className="flex-1" />
          <div className="hidden items-center md:flex">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={undo} aria-label="Undo">
                  <Undo2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Undo (Ctrl/⌘ Z)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={redo} aria-label="Redo">
                  <Redo2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Redo (Ctrl/⌘ Shift Z)</TooltipContent>
            </Tooltip>
          </div>
          <VersionHistory
            flowId={flow.id}
            versions={versions}
            liveVersionId={flow.publishedVersionId}
            dirty={dirty}
            onDraftReplaced={() => {
              // The server draft changed (rollback/restore): reload so the canvas starts from it.
              skipUnloadGuard.current = true;
              window.location.reload();
            }}
          />
          <Button variant="outline" size="sm" onClick={() => openTab("test")} className="hidden sm:inline-flex">
            <FlaskConical /> Test
          </Button>
          {!isDesktop && (
            <Button variant="outline" size="icon-sm" onClick={() => openTab(tab)} aria-label="Open step settings">
              <SlidersHorizontal />
            </Button>
          )}
          <Button size="sm" onClick={openPublish} disabled={flow.status === "archived"}>
            <Rocket /> Publish
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" disabled={statusPending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuItem onSelect={runLayout}>
                <Wand2 /> Tidy up layout
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  try {
                    await navigator.clipboard.writeText(exportFlowJson(definition, { name, description: flow.description }));
                    toast.success("JSON copied — paste it into ChatGPT with the changes you want");
                  } catch {
                    toast.error("Couldn't copy to the clipboard");
                  }
                }}
              >
                <Copy /> Copy JSON for ChatGPT
              </DropdownMenuItem>
              <DropdownMenuItem disabled={flow.status === "archived"} onSelect={() => setImportOpen(true)}>
                <FileJson /> Replace from JSON…
              </DropdownMenuItem>
              <DropdownMenuItem className="md:hidden" onSelect={undo}>
                <Undo2 /> Undo
              </DropdownMenuItem>
              <DropdownMenuItem className="sm:hidden" onSelect={() => openTab("test")}>
                <FlaskConical /> Test in simulator
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {flow.status !== "active" && (
                <DropdownMenuItem disabled={!flow.publishedVersionId} onSelect={() => changeStatus("active")}>
                  <Play /> Make live
                </DropdownMenuItem>
              )}
              {flow.status !== "testing" && (
                <DropdownMenuItem disabled={!flow.publishedVersionId} onSelect={() => changeStatus("testing")}>
                  <FlaskConical /> Use for test numbers
                </DropdownMenuItem>
              )}
              {(flow.status === "active" || flow.status === "testing") && (
                <DropdownMenuItem onSelect={() => changeStatus("paused")}>
                  <Pause /> Pause (stops open chats)
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => startStatus(async () => void (await duplicateFlowAction({ flowId: flow.id })))}>
                <Copy /> Duplicate workflow
              </DropdownMenuItem>
              {flow.status !== "archived" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => changeStatus("archived")}>
                    <Archive /> Archive
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Palette */}
          <aside className="hidden w-60 shrink-0 border-r bg-background md:block">
            <Palette onAdd={addFromPalette} hasTrigger={hasTrigger} />
          </aside>

          {/* Canvas */}
          <div ref={canvasRef} className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <ReactFlow<EditorNode, EditorEdge>
              nodes={displayNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              onNodeClick={() => {
                setTab((t) => (t === "test" ? t : "edit"));
                if (!isDesktop) setSheetOpen(true);
              }}
              fitView
              fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
              minZoom={0.2}
              maxZoom={1.75}
              deleteKeyCode={["Delete", "Backspace"]}
              multiSelectionKeyCode={["Shift", "Meta", "Control"]}
              snapToGrid
              snapGrid={[10, 10]}
              proOptions={{ hideAttribution: true }}
              colorMode={resolvedTheme === "dark" ? "dark" : "light"}
              defaultEdgeOptions={{ type: EDGE_TYPE }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} position="bottom-left" className="overflow-hidden rounded-xl border shadow-sm">
                <ControlButton onClick={runLayout} title="Tidy up layout" aria-label="Tidy up layout">
                  <Wand2 />
                </ControlButton>
              </Controls>
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                nodeColor={resolvedTheme === "dark" ? "#3a3a3a" : "#d9d9d9"}
                nodeBorderRadius={8}
                className="!hidden overflow-hidden rounded-xl border md:!block"
                style={{ width: 176, height: 112 }}
              />
            </ReactFlow>

            {!hasTrigger && (
              <div className="absolute inset-x-0 top-6 mx-auto flex w-fit items-center gap-3 rounded-2xl border bg-background px-4 py-3 text-sm shadow-sm">
                Every flow needs a start step.
                <Button size="sm" onClick={() => addFromPalette("trigger")}>
                  <Plus /> Add start step
                </Button>
              </div>
            )}

            {dropPicker && (
              <StepPicker open onOpenChange={(o) => !o && setDropPicker(null)} onPick={pickAtDrop} anchor align="start">
                <span className="pointer-events-none absolute size-px" style={{ left: dropPicker.left, top: dropPicker.top }} />
              </StepPicker>
            )}

            {/* Small screens have no palette: one button opens the step list. */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 md:hidden">
              <StepPicker open={addOpen} onOpenChange={setAddOpen} onPick={addFromPalette} side="top">
                <Button className="shadow-lg">
                  <Plus /> Add step
                </Button>
              </StepPicker>
            </div>
          </div>

          {/* Right panel (desktop) */}
          {isDesktop && <aside className="flex w-[380px] shrink-0 flex-col border-l bg-background 2xl:w-[440px]">{panel}</aside>}
        </div>
      </div>

      {/* Right panel as a bottom sheet on smaller screens */}
      {!isDesktop && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="bottom" className="h-[80dvh] gap-0 rounded-t-3xl p-0">
            <SheetHeader className="sr-only">
              <SheetTitle>Step settings</SheetTitle>
            </SheetHeader>
            <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-muted" />
            <div className="flex min-h-0 flex-1 flex-col">{panel}</div>
          </SheetContent>
        </Sheet>
      )}

      <ImportFlowDialog
        mode="replace"
        flowId={flow.id}
        open={importOpen}
        onOpenChange={setImportOpen}
        onReplaced={() => {
          // The server draft changed: reload so the canvas starts from it.
          skipUnloadGuard.current = true;
          window.location.reload();
        }}
      />

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        flowId={flow.id}
        flowName={name}
        definition={definition}
        hasTestNumbers={settings.testPhoneNumbers.length > 0}
        onPublished={() => {
          skipUnloadGuard.current = true;
          window.location.reload();
        }}
      />
    </EditorContext.Provider>
  );
}

