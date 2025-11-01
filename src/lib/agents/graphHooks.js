import { storeToolContext, consumeToolContext, updateToolContext } from './toolContext';
export function tagAgent(agent, agentId) {
    Reflect.set(agent, '__agentId', agentId);
    return agent;
}
export function getTaggedAgentId(agent) {
    return Reflect.get(agent, '__agentId');
}
export function attachAgentLifecycle(agent, agentId, callGraph) {
    tagAgent(agent, agentId);
    agent.on('agent_start', () => {
        callGraph.startAgent(agentId, agent.name);
    });
    agent.on('agent_end', (_context, output) => {
        callGraph.endAgent(agentId, 'success', { output });
    });
    agent.on('agent_handoff', (_context, nextAgent) => {
        const currentNode = callGraph.currentAgentNode(agentId);
        if (!currentNode)
            return;
        const nextAgentId = getTaggedAgentId(nextAgent) ?? nextAgent?.name;
        if (!nextAgentId)
            return;
        callGraph.queueHandoff(nextAgentId, currentNode.id);
    });
    agent.on('agent_tool_start', (_context, tool, details) => {
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
        }
        else {
            storeToolContext(callId, { agentId });
        }
    });
    agent.on('agent_tool_end', (_context, _tool, result, details) => {
        const callId = details?.toolCall?.id;
        if (callId) {
            callGraph.completeTool(callId, 'success', { result });
            updateToolContext(callId, { agentId });
            consumeToolContext(callId);
        }
    });
}
function safeExtractParameters(input) {
    if (!input)
        return undefined;
    if (typeof input === 'object') {
        return input;
    }
    if (typeof input === 'string') {
        try {
            return JSON.parse(input);
        }
        catch {
            return { raw: input };
        }
    }
    return { value: input };
}
