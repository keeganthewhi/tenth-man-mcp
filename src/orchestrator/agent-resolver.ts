// ============================================================
// 10th Man Protocol MCP — Agent Resolver
// ============================================================

import type { AgentAssignment, AgentRole, RuntimeConfig } from '../types.js';
import { MODELS } from '../types.js';

/**
 * Resolve which agents to assign to each contrarian role.
 *
 * Priority cascade:
 * 1. Both Codex + Gemini available → Codex, Gemini, Opus subagent
 * 2. One external available → external + 2 Opus subagents
 * 3. Neither available → 3 isolated Opus subagents
 *
 * All Claude subagents run in isolated context windows with zero opinion bleed.
 */
export function resolveAgents(config: RuntimeConfig): AgentAssignment[] {
  const hasCodex = config.available_agents.has('codex');
  const hasGemini = config.available_agents.has('gemini');

  // Best case: 3 different engines
  if (hasCodex && hasGemini) {
    return [
      {
        role: 'devils_advocate',
        engine: 'codex',
        model: MODELS.codex,
        via: 'subprocess',
      },
      {
        role: 'architecture_critic',
        engine: 'gemini',
        model: MODELS.gemini,
        via: 'subprocess',
      },
      {
        role: 'pragmatist',
        engine: 'claude',
        model: MODELS.claude,
        via: 'subagent_prompt',
      },
    ];
  }

  // One external: Codex only
  if (hasCodex) {
    return [
      {
        role: 'devils_advocate',
        engine: 'codex',
        model: MODELS.codex,
        via: 'subprocess',
      },
      {
        role: 'architecture_critic',
        engine: 'claude',
        model: MODELS.claude,
        via: 'subagent_prompt',
      },
      {
        role: 'pragmatist',
        engine: 'claude',
        model: MODELS.claude,
        via: 'subagent_prompt',
      },
    ];
  }

  // One external: Gemini only
  if (hasGemini) {
    return [
      {
        role: 'devils_advocate',
        engine: 'gemini',
        model: MODELS.gemini,
        via: 'subprocess',
      },
      {
        role: 'architecture_critic',
        engine: 'claude',
        model: MODELS.claude,
        via: 'subagent_prompt',
      },
      {
        role: 'pragmatist',
        engine: 'claude',
        model: MODELS.claude,
        via: 'subagent_prompt',
      },
    ];
  }

  // No externals: 3 isolated Opus subagents
  return [
    {
      role: 'devils_advocate',
      engine: 'claude',
      model: MODELS.claude,
      via: 'subagent_prompt',
    },
    {
      role: 'architecture_critic',
      engine: 'claude',
      model: MODELS.claude,
      via: 'subagent_prompt',
    },
    {
      role: 'pragmatist',
      engine: 'claude',
      model: MODELS.claude,
      via: 'subagent_prompt',
    },
  ];
}

/**
 * Describe the agent configuration for user-facing output.
 */
export function describeAgentConfig(assignments: AgentAssignment[]): string {
  const external = assignments.filter((a) => a.via === 'subprocess');
  const internal = assignments.filter((a) => a.via === 'subagent_prompt');

  if (external.length === 2) {
    return `3 agents: ${external[0].engine} (${external[0].model}) + ${external[1].engine} (${external[1].model}) + Claude (${MODELS.claude})`;
  }
  if (external.length === 1) {
    return `3 agents: ${external[0].engine} (${external[0].model}) + 2× Claude (${MODELS.claude}) isolated subagents`;
  }
  return `3 isolated Claude (${MODELS.claude}) subagents — separate context windows, zero opinion bleed`;
}
