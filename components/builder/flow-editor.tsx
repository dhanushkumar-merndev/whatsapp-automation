"use client";

import "@xyflow/react/dist/style.css";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type IsValidConnection,
} from "@xyflow/react";
import {
  ArrowLeft,
  Copy,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Redo2,
  Rocket,
  Save,
  Archive,
  FlaskConical,
  Undo2,
  Wand2,
  Maximize,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/common/status-badge";
import { NODE_REGISTRY } from "@/lib/engine/registry";
import type { FlowDefinition, NodeType } from "@/lib/engine/schema";
import { validateFlow } from "@/lib/engine/validate-graph";
import { estimateFlow, type EstimatorAssumptions, type PlanContext } from "@/lib/estimator/estimate";
import type { AppSettings } from "@/lib/settings/schema";
import { duplicateFlowAction, saveDraftAction, setFlowStatusAction, updateFlowDetailsAction } from "@/app/(dashboard)/flows/actions";
import { autoLayout, createNode, edgeStyle, newNodeId, toDefinition, toEditor, type EditorEdge, type EditorNode } from "./model";
import { FlowNode } from "./flow-node";
import { DRAG_MIME, Palette } from "./palette";
import { PropertiesPanel } from "./properties-panel";
import { EstimatorPanel } from "./estimator-panel";
import { ValidationList } from "./validation-list";
import { Simulator } from "./simulator";
import { PublishDialog } from "./publish-dialog";
import { VersionHistory, type VersionItem } from "./version-history";
import { EditorContext, type CrmOption, type MediaOption } from "./editor-context";

export interface FlowEditorProps {
  flow: {
    id: string;
    name: string;
    description: string | null;
    status: "draft" | "testing" | "active" | "paused" | "archived";
    priority: number;
    draftDefinition: FlowDefinition;
    draftUpdatedAt: string;
    publishedVersionId: string | null;
    liveVersion: number | null;
  };
  versions: VersionItem[];
  media: MediaOption[];
  crm: CrmOption[];
  plan: PlanContext;
  defaultAssumptions: EstimatorAssumptions;
  settings: AppSettings;
}

const nodeTypes = { flowNode: FlowNode };
const ASSUMPTIONS_KEY = (flowId: string) => `sgh:estimator:${flowId}`;

function stripForKey(def: FlowDefinition, withPositions: boolean) {
  return JSON.stringify(withPositions ? def : { nodes: def.nodes.map((n) => ({ ...n, position: undefined })), edges: def.edges });
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorInner {...props} />
    </ReactFlowProvider>
  );
}

function EditorInner({ flow, versions, media, crm, plan, defaultAssumptions, settings }: FlowEditorProps) {
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const rf = useReactFlow<EditorNode, EditorEdge>();
  const initial = useMemo(() => toEditor(flow.draftDefinition), [flow.draftDefinition]);
  const [nodes, setNodes, onNodesChange] = useNodesState<EditorNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<EditorEdge>(initial.edges);
  const [name, setName] = useState(flow.name);
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(flow.draftUpdatedAt);
  const [tab, setTab] = useState("properties");
  const [publishOpen, setPublishOpen] = useState(false);
  const [path, setPath] = useState<{ visited: string[]; current: string | null } | null>(null);
  const [saving, startSaving] = useTransition();
  const [statusPending, startStatus] = useTransition();
  // Per-flow estimator assumptions are remembered in this browser only (client-only component).
  const [assumptions, setAssumptions] = useState<EstimatorAssumptions>(() => {
    try {
      const raw = localStorage.getItem(ASSUMPTIONS_KEY(flow.id));
      if (raw) return { ...defaultAssumptions, ...JSON.parse(raw) };
    } catch {}
    return defaultAssumptions;
  });
  const clipboard = useRef<{ nodes: EditorNode[]; edges: EditorEdge[] } | null>(null);

  const initialKey = useMemo(() => stripForKey(flow.draftDefinition, true), [flow.draftDefinition]);
  const [savedKey, setSavedKey] = useState(initialKey);
  /** Set before an intentional reload so the unsaved-changes prompt is skipped. */
  const skipUnloadGuard = useRef(false);

  const updateAssumptions = (a: EstimatorAssumptions) => {
    setAssumptions(a);
    try {
      localStorage.setItem(ASSUMPTIONS_KEY(flow.id), JSON.stringify(a));
    } catch {}
  };

  const definition = useMemo(() => toDefinition(nodes, edges), [nodes, edges]);
  const fullKey = useMemo(() => stripForKey(definition, true), [definition]);
  const logicalKey = useMemo(() => stripForKey(definition, false), [definition]);
  // Recompute validation/estimates only when the logic changes (not while dragging).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const logicalDefinition = useMemo(() => definition, [logicalKey]);
  const validation = useMemo(() => validateFlow(logicalDefinition), [logicalDefinition]);
  const report = useMemo(
    () => estimateFlow({ flowName: name, definition: logicalDefinition, assumptions, plan }),
    [logicalDefinition, assumptions, plan, name],
  );
  const dirty = fullKey !== savedKey;

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
      const def = JSON.parse(key) as FlowDefinition;
      const next = toEditor(def);
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
      const target = nodes.find((n) => n.id === c.target);
      return Boolean(target && NODE_REGISTRY[target.data.nodeType].hasInput);
    },
    [nodes],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const handle = c.sourceHandle ?? "out";
      setEdges((eds) =>
        addEdge(
          { ...c, sourceHandle: handle, id: `e_${c.source}_${handle}_${c.target}`, ...edgeStyle(handle) },
          // One connection per output: replace an existing edge from the same handle.
          eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "out") === handle)),
        ),
      );
    },
    [setEdges],
  );

  const addNodeAt = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      if (NODE_REGISTRY[type].singleton && nodes.some((n) => n.data.nodeType === type)) {
        toast.error("A flow can only have one trigger.");
        return;
      }
      const node = createNode(type, position);
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), node]);
      setTab("properties");
    },
    [nodes, setNodes],
  );

  const addNodeCentered = useCallback(
    (type: NodeType) => {
      const el = document.querySelector(".react-flow");
      const rect = el?.getBoundingClientRect();
      const p = rf.screenToFlowPosition({
        x: (rect?.left ?? 0) + (rect?.width ?? 800) / 2 - 130,
        y: (rect?.top ?? 0) + (rect?.height ?? 600) / 2 - 40,
      });
      addNodeAt(type, p);
    },
    [rf, addNodeAt],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(DRAG_MIME) as NodeType;
      if (!type || !(type in NODE_REGISTRY)) return;
      addNodeAt(type, rf.screenToFlowPosition({ x: e.clientX - 130, y: e.clientY - 30 }));
    },
    [rf, addNodeAt],
  );

  const selectedNodes = nodes.filter((n) => n.selected);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null;

  const updateNode = useCallback(
    (id: string, patch: Partial<EditorNode["data"]>) =>
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))),
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
            data: { ...structuredClone({ ...n.data, highlight: null }) },
          } as EditorNode;
        });
      const copiedEdges = source.edges
        .filter((e) => map.has(e.source) && map.has(e.target))
        .map((e) => {
          const s = map.get(e.source)!;
          const t = map.get(e.target)!;
          const h = e.sourceHandle ?? "out";
          return { ...e, id: `e_${s}_${h}_${t}`, source: s, target: t, selected: false };
        });
      if (!copies.length) return;
      setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...copies]);
      setEdges((eds) => [...eds, ...copiedEdges]);
    },
    [setNodes, setEdges],
  );

  const copySelection = useCallback(() => {
    const sel = nodes.filter((n) => n.selected);
    if (!sel.length) return;
    const ids = new Set(sel.map((n) => n.id));
    clipboard.current = { nodes: sel, edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    toast.message(`Copied ${sel.length} node(s)`);
  }, [nodes, edges]);

  const runLayout = useCallback(() => {
    setNodes((nds) => autoLayout(nds, edges));
    setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50);
  }, [edges, setNodes, rf]);

  // --- Save / status ------------------------------------------------------------------
  const save = useCallback(
    (opts: { silent?: boolean } = {}) =>
      new Promise<boolean>((resolve) => {
        startSaving(async () => {
          const def = toDefinition(nodes, edges);
          const r = await saveDraftAction({ flowId: flow.id, definition: def, expectedDraftUpdatedAt: draftUpdatedAt });
          if (!r.ok) {
            toast.error(r.error);
            resolve(false);
            return;
          }
          setDraftUpdatedAt(r.data!.draftUpdatedAt);
          setSavedKey(stripForKey(def, true));
          if (!opts.silent) toast.success("Draft saved");
          resolve(true);
        });
      }),
    [nodes, edges, flow.id, draftUpdatedAt],
  );

  const changeStatus = (status: "active" | "testing" | "paused" | "archived") =>
    startStatus(async () => {
      if (status === "archived" && !confirm("Archive this flow? It stops running and is hidden from the active list.")) return;
      const r = await setFlowStatusAction({ flowId: flow.id, status });
      if (!r.ok) toast.error(r.error);
      else {
        const cancelled = (r.data as { cancelled?: number } | undefined)?.cancelled ?? 0;
        toast.success(`Flow ${status}${cancelled ? ` · ${cancelled} pending delayed step(s) cancelled` : ""}`);
        router.refresh();
      }
    });

  const saveName = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === flow.name) {
      setName(flow.name);
      return;
    }
    const r = await updateFlowDetailsAction({ flowId: flow.id, name: trimmed, description: flow.description ?? "", priority: flow.priority });
    if (!r.ok) {
      toast.error(r.error);
      setName(flow.name);
    } else router.refresh();
  };

  // --- Keyboard shortcuts & unsaved-changes guard -------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest("input, textarea, [contenteditable=true], [role=combobox]");
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "c") {
        copySelection();
      } else if (mod && e.key.toLowerCase() === "v") {
        if (clipboard.current) {
          e.preventDefault();
          cloneInto(clipboard.current, 60);
        }
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const sel = nodes.filter((n) => n.selected);
        const ids = new Set(sel.map((n) => n.id));
        cloneInto({ nodes: sel, edges: edges.filter((x) => ids.has(x.source) && ids.has(x.target)) }, 40);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, copySelection, cloneInto, nodes, edges]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty || skipUnloadGuard.current) return;
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

  const displayNodes = useMemo(
    () =>
      nodes.map((n) => {
        const highlight: EditorNode["data"]["highlight"] = path
          ? path.current === n.id
            ? "current"
            : path.visited.includes(n.id)
              ? "visited"
              : null
          : null;
        const issues = issuesByNode.get(n.id) ?? 0;
        return highlight || issues ? ({ ...n, data: { ...n.data, highlight, issues } } as EditorNode) : n;
      }),
    [nodes, path, issuesByNode],
  );

  const ctx = useMemo(
    () => ({ media, crm, mediaNames: Object.fromEntries(media.map((m) => [m.id, m.name])) }),
    [media, crm],
  );
  const selectNode = (id: string) => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === id })));
    const n = nodes.find((x) => x.id === id);
    if (n) rf.setCenter(n.position.x + 130, n.position.y + 46, { zoom: 1, duration: 300 });
    setTab("properties");
  };

  const openPublish = async () => {
    if (dirty && !(await save({ silent: true }))) return;
    setPublishOpen(true);
  };

  const issuesCount = validation.errors.length + validation.warnings.length;

  return (
    <EditorContext.Provider value={ctx}>
      <div data-full-bleed className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link
              href="/flows"
              aria-label="Back to flows"
              onClick={(e) => {
                if (dirty && !confirm("You have unsaved changes. Leave without saving?")) e.preventDefault();
              }}
            >
              <ArrowLeft />
            </Link>
          </Button>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="h-8 w-56 border-transparent text-sm font-medium shadow-none hover:border-input"
            aria-label="Flow name"
          />
          <StatusBadge status={flow.status} />
          {flow.liveVersion && <span className="text-xs text-muted-foreground">v{flow.liveVersion} live</span>}
          {dirty ? (
            <span className="text-xs text-warning">● Unsaved changes</span>
          ) : (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          <div className="flex-1" />
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={runLayout} aria-label="Auto layout">
                <Wand2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Auto-align nodes</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => rf.fitView({ padding: 0.15, duration: 300 })} aria-label="Fit to screen">
                <Maximize />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fit to screen</TooltipContent>
          </Tooltip>
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
          <Button variant="outline" size="sm" onClick={() => setTab("test")}>
            <FlaskConical /> Test
          </Button>
          <Button variant="outline" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />} Save draft
          </Button>
          <Button size="sm" onClick={openPublish} disabled={saving || flow.status === "archived"}>
            <Rocket /> Publish
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More actions" disabled={statusPending}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {flow.status !== "active" && (
                <DropdownMenuItem disabled={!flow.publishedVersionId} onSelect={() => changeStatus("active")}>
                  <Play /> Activate for all customers
                </DropdownMenuItem>
              )}
              {flow.status !== "testing" && (
                <DropdownMenuItem disabled={!flow.publishedVersionId} onSelect={() => changeStatus("testing")}>
                  <FlaskConical /> Test numbers only
                </DropdownMenuItem>
              )}
              {(flow.status === "active" || flow.status === "testing") && (
                <DropdownMenuItem onSelect={() => changeStatus("paused")}>
                  <Pause /> Pause flow
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => startStatus(async () => void (await duplicateFlowAction({ flowId: flow.id })))}>
                <Copy /> Duplicate flow
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {flow.status !== "archived" && (
                <DropdownMenuItem variant="destructive" onSelect={() => changeStatus("archived")}>
                  <Archive /> Archive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Palette */}
          <aside className="hidden w-60 shrink-0 border-r bg-background md:block">
            <Palette onAdd={addNodeCentered} hasTrigger={hasTrigger} />
          </aside>

          {/* Canvas */}
          <div className="relative min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
            <ReactFlow<EditorNode, EditorEdge>
              nodes={displayNodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={() => setTab((t) => (t === "test" ? t : "properties"))}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.2}
              maxZoom={1.75}
              deleteKeyCode={["Delete", "Backspace"]}
              multiSelectionKeyCode={["Shift", "Meta", "Control"]}
              snapToGrid
              snapGrid={[10, 10]}
              proOptions={{ hideAttribution: true }}
              colorMode={resolvedTheme === "dark" ? "dark" : "light"}
              defaultEdgeOptions={{ type: "smoothstep" }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
              <Controls showInteractive={false} position="bottom-left" />
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                nodeColor={(n) => NODE_REGISTRY[(n.data as EditorNode["data"]).nodeType]?.color ?? "#94a3b8"}
                className="!h-28 !w-44 overflow-hidden rounded-xl border"
              />
            </ReactFlow>
            {nodes.length <= 1 && (
              <div className="pointer-events-none absolute inset-x-0 top-6 mx-auto w-fit rounded-md border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
                Drag nodes from the left, then connect them from the bottom handle of one node to the top of the next.
              </div>
            )}
          </div>

          {/* Right panel */}
          <aside className="flex w-[360px] shrink-0 flex-col border-l bg-background">
            <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
              <TabsList className="m-2 grid w-auto grid-cols-4">
                <TabsTrigger value="properties">Properties</TabsTrigger>
                <TabsTrigger value="estimate">Usage</TabsTrigger>
                <TabsTrigger value="check">
                  Check
                  {issuesCount > 0 && (
                    <span className={`ml-1 rounded px-1 text-[10px] ${validation.errors.length ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"}`}>
                      {issuesCount}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="test">Test</TabsTrigger>
              </TabsList>
              <TabsContent value="properties" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <PropertiesPanel
                    node={selected}
                    issues={selected ? [...validation.errors, ...validation.warnings].filter((i) => i.nodeId === selected.id) : []}
                    onChange={(config) => selected && updateNode(selected.id, { config })}
                    onLabel={(label) => selected && updateNode(selected.id, { label })}
                    onDelete={() => selected && deleteNodes([selected.id])}
                    onDuplicate={() => selected && cloneInto({ nodes: [selected], edges: [] }, 40)}
                  />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="estimate" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <EstimatorPanel assumptions={assumptions} onChange={updateAssumptions} report={report} />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="check" className="min-h-0 flex-1">
                <ScrollArea className="h-full">
                  <ValidationList validation={validation} onSelect={selectNode} />
                </ScrollArea>
              </TabsContent>
              <TabsContent value="test" className="min-h-0 flex-1">
                <Simulator definition={logicalDefinition} settings={settings} media={media} onPath={setPath} />
              </TabsContent>
            </Tabs>
          </aside>
        </div>
      </div>

      <PublishDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        flowId={flow.id}
        flowName={name}
        definition={definition}
        assumptions={assumptions}
        hasTestNumbers={settings.testPhoneNumbers.length > 0}
        onPublished={() => {
          setSavedKey(fullKey);
          skipUnloadGuard.current = true;
          window.location.reload();
        }}
      />
    </EditorContext.Provider>
  );
}
