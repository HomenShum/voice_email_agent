export interface ToolCallContext {
  agentId?: string;
  graphNodeId?: string;
  parentNodeId?: string;
  depth?: number;
}

const contextByCallId = new Map<string, ToolCallContext>();

export function storeToolContext(callId: string, context: ToolCallContext) {
  if (!callId) return;
  contextByCallId.set(callId, context);
}

export function updateToolContext(callId: string, partial: Partial<ToolCallContext>) {
  if (!callId) return;
  const current = contextByCallId.get(callId) ?? {};
  contextByCallId.set(callId, { ...current, ...partial });
}

export function consumeToolContext(callId: string): ToolCallContext | undefined {
  if (!callId) return undefined;
  const context = contextByCallId.get(callId);
  contextByCallId.delete(callId);
  return context;
}

export function peekToolContext(callId: string): ToolCallContext | undefined {
  if (!callId) return undefined;
  return contextByCallId.get(callId);
}
