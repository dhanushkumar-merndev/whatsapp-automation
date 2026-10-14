import type { FlowDefinition } from "@/lib/engine/schema";
import { NODE_REGISTRY } from "@/lib/engine/registry";

/** A new flow starts with the customer-message trigger only. */
export function blankFlowDefinition(): FlowDefinition {
  return {
    nodes: [
      {
        id: "n_trigger",
        type: "trigger",
        position: { x: 0, y: 0 },
        data: { label: "Customer sends a message", config: NODE_REGISTRY.trigger.defaults() },
      },
    ],
    edges: [],
  };
}
