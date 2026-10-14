import type { FlowDefinition, FlowEdge, FlowNode } from "./schema";

/** Read-only adjacency helper over a flow definition. */
export class FlowGraph {
  readonly nodes = new Map<string, FlowNode>();
  private readonly outgoing = new Map<string, FlowEdge[]>();
  private readonly incoming = new Map<string, FlowEdge[]>();

  constructor(readonly definition: FlowDefinition) {
    for (const n of definition.nodes) this.nodes.set(n.id, n);
    for (const e of definition.edges) {
      if (!this.outgoing.has(e.source)) this.outgoing.set(e.source, []);
      this.outgoing.get(e.source)!.push(e);
      if (!this.incoming.has(e.target)) this.incoming.set(e.target, []);
      this.incoming.get(e.target)!.push(e);
    }
  }

  get(id: string | null | undefined): FlowNode | undefined {
    return id ? this.nodes.get(id) : undefined;
  }

  trigger(): FlowNode | undefined {
    return this.definition.nodes.find((n) => n.type === "trigger");
  }

  edgesFrom(id: string): FlowEdge[] {
    return this.outgoing.get(id) ?? [];
  }

  edgesTo(id: string): FlowEdge[] {
    return this.incoming.get(id) ?? [];
  }

  /** Target of the edge leaving `id` through `handle` ("out" for single-output nodes). */
  next(id: string, handle = "out"): string | null {
    const edge = this.edgesFrom(id).find((e) => (e.sourceHandle ?? "out") === handle);
    return edge && this.nodes.has(edge.target) ? edge.target : null;
  }
}
