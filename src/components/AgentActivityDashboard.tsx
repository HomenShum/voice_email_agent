/**
 * Agent Activity Dashboard - Real-Time UI for Agent Orchestration
 * 
 * This component displays a hierarchical, real-time view of all agent activity:
 * 
 * Level 1: Current active agent (RouterAgent or specialist)
 * Level 2: Tasks delegated to each agent (with timestamps)
 * Level 3: Tool calls made per task (with parameters and results)
 * Level 4: Live status updates (queued, in-progress, completed, failed)
 * 
 * The dashboard updates in real-time as backend events are emitted.
 */

import React, { useState, useEffect } from 'react';
import type { UIDashboardEvent } from '../lib/agents/backendRuntime';
import type { GraphNode, GraphEdge } from '../lib/agents/callGraph';

// ============================================================================
// Types
// ============================================================================

interface AgentNode {
  id: string;
  type: 'agent' | 'tool' | 'handoff';
  name: string;
  agentId: string;
  status: 'pending' | 'in-progress' | 'completed' | 'error';
  timestamp: number;
  duration?: number;
  parameters?: any;
  result?: any;
  message?: string;
  children: AgentNode[];
  depth: number;
}

interface AgentActivityDashboardProps {
  onEventReceived?: (event: UIDashboardEvent) => void;
  className?: string;
}

// ============================================================================
// Agent Activity Dashboard Component
// ============================================================================

export function AgentActivityDashboard({ onEventReceived, className = '' }: AgentActivityDashboardProps) {
  const [rootNodes, setRootNodes] = useState<AgentNode[]>([]);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Subscribe to events from the hybrid bridge
  useEffect(() => {
    // This will be wired up to the HybridAgentBridge event stream
    // For now, we'll set up the handler
    if (onEventReceived) {
      // Event handler is passed as prop
    }
  }, [onEventReceived]);

  /**
   * Add a new event to the dashboard
   */
  const addEvent = (event: UIDashboardEvent) => {
    setRootNodes((prevNodes) => {
      const newNode: AgentNode = {
        id: event.id,
        type: event.type,
        name: event.agentName || event.toolName || event.agentId,
        agentId: event.agentId,
        status: event.status,
        timestamp: event.timestamp,
        parameters: event.parameters,
        result: event.result,
        message: event.message,
        children: [],
        depth: 0,
      };

      // Find parent node if this is a child event
      const updatedNodes = [...prevNodes];
      
      if (event.type === 'tool') {
        // Tools are children of agents
        const parentAgent = findNodeByAgentId(updatedNodes, event.agentId);
        if (parentAgent) {
          parentAgent.children.push({ ...newNode, depth: parentAgent.depth + 1 });
          return updatedNodes;
        }
      } else if (event.type === 'handoff') {
        // Handoffs create new agent nodes
        updatedNodes.push(newNode);
        return updatedNodes;
      } else if (event.type === 'agent') {
        // Check if agent already exists (update status)
        const existingAgent = findNodeByAgentId(updatedNodes, event.agentId);
        if (existingAgent) {
          existingAgent.status = event.status;
          existingAgent.result = event.result;
          if (event.status === 'completed') {
            existingAgent.duration = event.timestamp - existingAgent.timestamp;
          }
          return updatedNodes;
        } else {
          // New agent node
          updatedNodes.push(newNode);
          return updatedNodes;
        }
      }

      return updatedNodes;
    });

    // Auto-expand new nodes
    setExpandedNodes((prev) => new Set([...prev, event.id]));
  };

  /**
   * Find a node by agent ID
   */
  const findNodeByAgentId = (nodes: AgentNode[], agentId: string): AgentNode | null => {
    for (const node of nodes) {
      if (node.agentId === agentId) {
        return node;
      }
      const found = findNodeByAgentId(node.children, agentId);
      if (found) return found;
    }
    return null;
  };

  /**
   * Toggle node expansion
   */
  const toggleNode = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  /**
   * Select a node for detailed view
   */
  const selectNode = (nodeId: string) => {
    setSelectedNode(nodeId === selectedNode ? null : nodeId);
  };

  /**
   * Clear all nodes
   */
  const clearDashboard = () => {
    setRootNodes([]);
    setExpandedNodes(new Set());
    setSelectedNode(null);
  };

  // Expose addEvent method to parent component
  useEffect(() => {
    if (onEventReceived) {
      // This is a placeholder - the actual wiring happens in the parent component
      (window as any).__addDashboardEvent = addEvent;
    }
  }, [onEventReceived]);

  return (
    <div className={`agent-activity-dashboard ${className}`}>
      <div className="dashboard-header">
        <h2>Agent Activity Dashboard</h2>
        <button onClick={clearDashboard} className="clear-button">
          Clear
        </button>
      </div>

      <div className="dashboard-content">
        {rootNodes.length === 0 ? (
          <div className="empty-state">
            <p>No agent activity yet. Start a conversation to see real-time updates.</p>
          </div>
        ) : (
          <div className="agent-tree">
            {rootNodes.map((node) => (
              <AgentNodeView
                key={node.id}
                node={node}
                isExpanded={expandedNodes.has(node.id)}
                isSelected={selectedNode === node.id}
                onToggle={() => toggleNode(node.id)}
                onSelect={() => selectNode(node.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedNode && (
        <NodeDetailsPanel
          node={findNodeById(rootNodes, selectedNode)}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Agent Node View Component
// ============================================================================

interface AgentNodeViewProps {
  node: AgentNode;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}

function AgentNodeView({ node, isExpanded, isSelected, onToggle, onSelect }: AgentNodeViewProps) {
  const hasChildren = node.children.length > 0;
  const statusIcon = getStatusIcon(node.status);
  const typeIcon = getTypeIcon(node.type);

  return (
    <div className={`agent-node depth-${node.depth}`}>
      <div
        className={`node-header ${isSelected ? 'selected' : ''} status-${node.status}`}
        onClick={onSelect}
      >
        {hasChildren && (
          <button className="expand-button" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
        <span className="type-icon">{typeIcon}</span>
        <span className="status-icon">{statusIcon}</span>
        <span className="node-name">{node.name}</span>
        <span className="node-timestamp">{formatTimestamp(node.timestamp)}</span>
        {node.duration && <span className="node-duration">{node.duration}ms</span>}
      </div>

      {isExpanded && hasChildren && (
        <div className="node-children">
          {node.children.map((child) => (
            <AgentNodeView
              key={child.id}
              node={child}
              isExpanded={true}
              isSelected={isSelected}
              onToggle={() => {}}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Node Details Panel Component
// ============================================================================

interface NodeDetailsPanelProps {
  node: AgentNode | null;
  onClose: () => void;
}

function NodeDetailsPanel({ node, onClose }: NodeDetailsPanelProps) {
  if (!node) return null;

  return (
    <div className="node-details-panel">
      <div className="panel-header">
        <h3>Node Details</h3>
        <button onClick={onClose} className="close-button">×</button>
      </div>

      <div className="panel-content">
        <div className="detail-row">
          <span className="detail-label">Type:</span>
          <span className="detail-value">{node.type}</span>
        </div>

        <div className="detail-row">
          <span className="detail-label">Name:</span>
          <span className="detail-value">{node.name}</span>
        </div>

        <div className="detail-row">
          <span className="detail-label">Status:</span>
          <span className={`detail-value status-${node.status}`}>{node.status}</span>
        </div>

        <div className="detail-row">
          <span className="detail-label">Timestamp:</span>
          <span className="detail-value">{new Date(node.timestamp).toLocaleString()}</span>
        </div>

        {node.duration && (
          <div className="detail-row">
            <span className="detail-label">Duration:</span>
            <span className="detail-value">{node.duration}ms</span>
          </div>
        )}

        {node.parameters && (
          <div className="detail-section">
            <h4>Parameters</h4>
            <pre className="detail-code">{JSON.stringify(node.parameters, null, 2)}</pre>
          </div>
        )}

        {node.result && (
          <div className="detail-section">
            <h4>Result</h4>
            <pre className="detail-code">{JSON.stringify(node.result, null, 2)}</pre>
          </div>
        )}

        {node.message && (
          <div className="detail-section">
            <h4>Message</h4>
            <p className="detail-message">{node.message}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

function getStatusIcon(status: string): string {
  switch (status) {
    case 'pending':
      return '⏳';
    case 'in-progress':
      return '🔄';
    case 'completed':
      return '✅';
    case 'error':
      return '❌';
    default:
      return '❓';
  }
}

function getTypeIcon(type: string): string {
  switch (type) {
    case 'agent':
      return '🤖';
    case 'tool':
      return '🔧';
    case 'handoff':
      return '🔀';
    default:
      return '📄';
  }
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function findNodeById(nodes: AgentNode[], id: string): AgentNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

export default AgentActivityDashboard;

