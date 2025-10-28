export type GraphStatus = 'pending' | 'success' | 'error';

export interface GraphNode {
  id: string;
  type: 'agent' | 'tool';
  name: string;
  agentId: string;
  parentId?: string;
  depth: number;
  status: GraphStatus;
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: 'handoff' | 'tool';
}

export type GraphEvent =
  | { type: 'node_started'; node: GraphNode }
  | { type: 'node_completed'; node: GraphNode }
  | { type: 'edge_added'; edge: GraphEdge };

export class CallGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly edges: GraphEdge[] = [];
  private readonly stack: string[] = [];
  private readonly activeNodesByAgent = new Map<string, string[]>();
  private readonly pendingParents = new Map<string, string[]>();
  private readonly toolNodesByCallId = new Map<string, string>();
  private handler?: (event: GraphEvent) => void;
  private counter = 0;

  setHandler(fn: (event: GraphEvent) => void) {
    this.handler = fn;
  }

  snapshot(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return { nodes: Array.from(this.nodes.values()), edges: [...this.edges] };
  }

  queueHandoff(targetAgentId: string, parentNodeId: string) {
    const arr = this.pendingParents.get(targetAgentId) ?? [];
    arr.push(parentNodeId);
    this.pendingParents.set(targetAgentId, arr);
  }

  startAgent(agentId: string, name: string, metadata?: Record<string, unknown>, explicitParentId?: string): GraphNode {
    const nodeId = `${agentId}:${Date.now()}:${++this.counter}`;
    const parentId = explicitParentId ?? this.consumePendingParent(agentId) ?? this.peekStack();
    const depth = typeof parentId === 'string' ? (this.nodes.get(parentId)?.depth ?? -1) + 1 : 0;
    const node: GraphNode = {
      id: nodeId,
      type: 'agent',
      name,
      agentId,
      parentId,
      depth,
      status: 'pending',
      startedAt: Date.now(),
      metadata,
    };
    this.nodes.set(nodeId, node);
    this.stack.push(nodeId);
    const list = this.activeNodesByAgent.get(agentId) ?? [];
    list.push(nodeId);
    this.activeNodesByAgent.set(agentId, list);
    if (parentId) {
      this.addEdge({ from: parentId, to: nodeId, type: 'handoff' });
    }
    this.emit({ type: 'node_started', node });
    return node;
  }

  endAgent(agentId: string, status: GraphStatus, metadata?: Record<string, unknown>): GraphNode | undefined {
    const nodeId = this.peekActiveAgentNode(agentId);
    if (!nodeId) return undefined;
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;
    node.status = status;
    node.endedAt = Date.now();
    node.metadata = { ...(node.metadata ?? {}), ...(metadata ?? {}) };
    this.popActiveAgentNode(agentId, nodeId);
    this.popStack(nodeId);
    this.emit({ type: 'node_completed', node });
    return node;
  }

  startTool(agentId: string, toolName: string, callId: string, parameters?: Record<string, unknown>): GraphNode | undefined {
    const parentId = this.peekActiveAgentNode(agentId);
    if (!parentId) return undefined;
    const parent = this.nodes.get(parentId);
    if (!parent) return undefined;
    const nodeId = `tool:${callId || toolName}:${Date.now()}:${++this.counter}`;
    const depth = parent.depth + 1;
    const node: GraphNode = {
      id: nodeId,
      type: 'tool',
      name: toolName,
      agentId,
      parentId,
      depth,
      status: 'pending',
      startedAt: Date.now(),
      metadata: { parameters },
    };
    this.nodes.set(nodeId, node);
    this.toolNodesByCallId.set(callId, nodeId);
    this.addEdge({ from: parentId, to: nodeId, type: 'tool' });
    this.emit({ type: 'node_started', node });
    return node;
  }

  completeTool(callId: string, status: GraphStatus, metadata?: Record<string, unknown>): GraphNode | undefined {
    const nodeId = this.toolNodesByCallId.get(callId);
    if (!nodeId) return undefined;
    const node = this.nodes.get(nodeId);
    if (!node) return undefined;
    node.status = status;
    node.endedAt = Date.now();
    node.metadata = { ...(node.metadata ?? {}), ...(metadata ?? {}) };
    this.emit({ type: 'node_completed', node });
    this.toolNodesByCallId.delete(callId);
    return node;
  }

  currentAgentNode(agentId: string): GraphNode | undefined {
    const nodeId = this.peekActiveAgentNode(agentId);
    return nodeId ? this.nodes.get(nodeId) : undefined;
  }

  private consumePendingParent(agentId: string): string | undefined {
    const arr = this.pendingParents.get(agentId);
    if (!arr?.length) return undefined;
    const parent = arr.shift();
    if (!arr.length) {
      this.pendingParents.delete(agentId);
    }
    return parent;
  }

  private peekActiveAgentNode(agentId: string): string | undefined {
    const arr = this.activeNodesByAgent.get(agentId);
    if (!arr?.length) return undefined;
    return arr[arr.length - 1];
  }

  private popActiveAgentNode(agentId: string, nodeId: string) {
    const arr = this.activeNodesByAgent.get(agentId);
    if (!arr) return;
    const idx = arr.lastIndexOf(nodeId);
    if (idx >= 0) {
      arr.splice(idx, 1);
    }
    if (!arr.length) {
      this.activeNodesByAgent.delete(agentId);
    } else {
      this.activeNodesByAgent.set(agentId, arr);
    }
  }

  private peekStack(): string | undefined {
    return this.stack[this.stack.length - 1];
  }

  private popStack(expectedId: string) {
    if (this.peekStack() === expectedId) {
      this.stack.pop();
    }
  }

  private addEdge(edge: GraphEdge) {
    this.edges.push(edge);
    this.emit({ type: 'edge_added', edge });
  }

  private emit(event: GraphEvent) {
    try {
      this.handler?.(event);
    } catch (err) {
      console.warn('[callGraph] handler error', err);
    }
  }
}
