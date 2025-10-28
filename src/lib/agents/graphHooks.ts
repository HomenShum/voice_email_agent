import type { Agent } from '@openai/agents-core';
import { CallGraph } from './callGraph';
import { storeToolContext, consumeToolContext, updateToolContext } from './toolContext';

export function tagAgent<T extends Agent<any, any>>(agent: T, agentId: string): T {
  Reflect.set(agent, '__agentId', agentId);
  return agent;
}

export function getTaggedAgentId(agent: Agent<any, any>): string | undefined {
  return Reflect.get(agent, '__agentId') as string | undefined;
}

export function attachAgentLifecycle(agent: Agent<any, any>, agentId: string, callGraph: CallGraph) {
  tagAgent(agent, agentId);

  agent.on('agent_start', () => {
    callGraph.startAgent(agentId, agent.name);
  });

  agent.on('agent_end', (_context: any, output: any) => {
    callGraph.endAgent(agentId, 'success', { output });
  });

  agent.on('agent_handoff', (_context: any, nextAgent: any) => {
    const currentNode = callGraph.currentAgentNode(agentId);
    if (!currentNode) return;
    const nextAgentId = getTaggedAgentId(nextAgent as Agent<any, any>) ?? nextAgent?.name;
    if (!nextAgentId) return;
    callGraph.queueHandoff(nextAgentId, currentNode.id);
  });

  agent.on('agent_tool_start', (_context: any, tool: any, details: any) => {
    const callId = details?.toolCall?.id ?? `${agentId}:${tool.name}:${Date.now()}`;
    const parameters = safeExtractParameters(details?.toolCall?.input);
    const node = callGraph.startTool(agentId, tool.name, callId, parameters);
    if (node) {
      storeToolContext(callId, {
        agentId,
        graphNodeId: node.id,
        parentNodeId: node.parentId,
        depth: node.depth,
      });
    } else {
      storeToolContext(callId, { agentId });
    }
  });

  agent.on('agent_tool_end', (_context: any, _tool: any, result: any, details: any) => {
    const callId = details?.toolCall?.id;
    if (callId) {
      callGraph.completeTool(callId, 'success', { result });
      updateToolContext(callId, { agentId });
      consumeToolContext(callId);
    }
  });
}

function safeExtractParameters(input: unknown): Record<string, unknown> | undefined {
  if (!input) return undefined;
  if (typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return { raw: input };
    }
  }
  return { value: input };
}
