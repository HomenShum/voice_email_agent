import { CallGraph } from './callGraph';
import { Scratchpad } from './scratchpad';

export const ROUTER_AGENT_ID = 'router';
export const EMAIL_AGENT_ID = 'email_ops';
export const INSIGHT_AGENT_ID = 'insight';
export const CONTACTS_AGENT_ID = 'contacts';
export const CALENDAR_AGENT_ID = 'calendar';
export const AUTOMATION_AGENT_ID = 'automation';

export const SPECIALIST_IDS = [
  EMAIL_AGENT_ID,
  INSIGHT_AGENT_ID,
  CONTACTS_AGENT_ID,
  CALENDAR_AGENT_ID,
  AUTOMATION_AGENT_ID,
] as const;

export type SpecialistId = typeof SPECIALIST_IDS[number];
export type AllAgentId = SpecialistId | typeof ROUTER_AGENT_ID;

export interface SpecialistEnvironment {
  id: SpecialistId;
  name: string;
  scratchpad: Scratchpad;
  callGraph: CallGraph;
  progress: (message: string) => void;
}

export interface RouterEnvironment {
  id: typeof ROUTER_AGENT_ID;
  name: string;
  callGraph: CallGraph;
  scratchpads: Record<AllAgentId, Scratchpad>;
  progress: (message: string) => void;
}

export interface RouterRuntime {
  router: RouterEnvironment;
  getSpecialistEnvironment(id: SpecialistId, name: string): SpecialistEnvironment;
}

export function createRouterRuntime(onProgress: (message: string) => void = () => {}): RouterRuntime {
  const callGraph = new CallGraph();
  const scratchpads = new Map<AllAgentId, Scratchpad>();

  const ensureScratchpad = (id: AllAgentId) => {
    if (!scratchpads.has(id)) {
      scratchpads.set(id, new Scratchpad());
    }
    return scratchpads.get(id)!;
  };

  const routerEnv: RouterEnvironment = {
    id: ROUTER_AGENT_ID,
    name: 'RouterAgent',
    callGraph,
    scratchpads: new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop !== 'string') return undefined;
          return ensureScratchpad(prop as AllAgentId);
        },
      },
    ) as Record<AllAgentId, Scratchpad>,
    progress: onProgress,
  };

  return {
    router: routerEnv,
    getSpecialistEnvironment(id: SpecialistId, name: string): SpecialistEnvironment {
      return {
        id,
        name,
        scratchpad: ensureScratchpad(id),
        callGraph,
        progress: onProgress,
      };
    },
  };
}
