export class CallGraph {
    nodes = new Map();
    edges = [];
    stack = [];
    activeNodesByAgent = new Map();
    pendingParents = new Map();
    toolNodesByCallId = new Map();
    handler;
    counter = 0;
    setHandler(fn) {
        this.handler = fn;
    }
    snapshot() {
        return { nodes: Array.from(this.nodes.values()), edges: [...this.edges] };
    }
    queueHandoff(targetAgentId, parentNodeId) {
        const arr = this.pendingParents.get(targetAgentId) ?? [];
        arr.push(parentNodeId);
        this.pendingParents.set(targetAgentId, arr);
    }
    startAgent(agentId, name, metadata, explicitParentId) {
        const nodeId = `${agentId}:${Date.now()}:${++this.counter}`;
        const parentId = explicitParentId ?? this.consumePendingParent(agentId) ?? this.peekStack();
        const depth = typeof parentId === 'string' ? (this.nodes.get(parentId)?.depth ?? -1) + 1 : 0;
        const node = {
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
    endAgent(agentId, status, metadata) {
        const nodeId = this.peekActiveAgentNode(agentId);
        if (!nodeId)
            return undefined;
        const node = this.nodes.get(nodeId);
        if (!node)
            return undefined;
        node.status = status;
        node.endedAt = Date.now();
        node.metadata = { ...(node.metadata ?? {}), ...(metadata ?? {}) };
        this.popActiveAgentNode(agentId, nodeId);
        this.popStack(nodeId);
        this.emit({ type: 'node_completed', node });
        return node;
    }
    startTool(agentId, toolName, callId, parameters) {
        const parentId = this.peekActiveAgentNode(agentId);
        if (!parentId)
            return undefined;
        const parent = this.nodes.get(parentId);
        if (!parent)
            return undefined;
        const nodeId = `tool:${callId || toolName}:${Date.now()}:${++this.counter}`;
        const depth = parent.depth + 1;
        const node = {
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
    completeTool(callId, status, metadata) {
        const nodeId = this.toolNodesByCallId.get(callId);
        if (!nodeId)
            return undefined;
        const node = this.nodes.get(nodeId);
        if (!node)
            return undefined;
        node.status = status;
        node.endedAt = Date.now();
        node.metadata = { ...(node.metadata ?? {}), ...(metadata ?? {}) };
        this.emit({ type: 'node_completed', node });
        this.toolNodesByCallId.delete(callId);
        return node;
    }
    currentAgentNode(agentId) {
        const nodeId = this.peekActiveAgentNode(agentId);
        return nodeId ? this.nodes.get(nodeId) : undefined;
    }
    consumePendingParent(agentId) {
        const arr = this.pendingParents.get(agentId);
        if (!arr?.length)
            return undefined;
        const parent = arr.shift();
        if (!arr.length) {
            this.pendingParents.delete(agentId);
        }
        return parent;
    }
    peekActiveAgentNode(agentId) {
        const arr = this.activeNodesByAgent.get(agentId);
        if (!arr?.length)
            return undefined;
        return arr[arr.length - 1];
    }
    popActiveAgentNode(agentId, nodeId) {
        const arr = this.activeNodesByAgent.get(agentId);
        if (!arr)
            return;
        const idx = arr.lastIndexOf(nodeId);
        if (idx >= 0) {
            arr.splice(idx, 1);
        }
        if (!arr.length) {
            this.activeNodesByAgent.delete(agentId);
        }
        else {
            this.activeNodesByAgent.set(agentId, arr);
        }
    }
    peekStack() {
        return this.stack[this.stack.length - 1];
    }
    popStack(expectedId) {
        if (this.peekStack() === expectedId) {
            this.stack.pop();
        }
    }
    addEdge(edge) {
        this.edges.push(edge);
        this.emit({ type: 'edge_added', edge });
    }
    emit(event) {
        try {
            this.handler?.(event);
        }
        catch (err) {
            console.warn('[callGraph] handler error', err);
        }
    }
}
