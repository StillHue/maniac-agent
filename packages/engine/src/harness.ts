import { runEngine, type EngineRunOptions } from './engine';

/**
 * Stable boundary between frontends (CLI, web, HTTP service) and the agent loop.
 * `runEngine` is the default implementation; alternative harnesses can swap in later.
 */
export interface AgentHarness {
  run(options: EngineRunOptions): Promise<string>;
}

export const defaultHarness: AgentHarness = {
  run: runEngine,
};

export { runEngine };
export type { EngineRunOptions };
