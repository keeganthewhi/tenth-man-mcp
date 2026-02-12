#!/usr/bin/env node
// ============================================================
// 10th Man Protocol MCP Server
//
// Adversarial review system for Claude Code. Spawns 3 contrarian
// agents to challenge proposed code changes before execution.
//
// Install:
//   npm install -g tenth-man-mcp
//   claude mcp add tenth-man -- npx tenth-man-mcp
//
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { buildRuntimeConfig, ensureGitignore, ensureDirectories, loadRepoConfig } from './config/loader.js';
import { ensureClaudeMd } from './config/claude-md.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAgents, describeAgentConfig } from './orchestrator/agent-resolver.js';
import { executeAgents } from './orchestrator/agent-invoker.js';
import { computeConsensus } from './orchestrator/result-merger.js';
import {
  generateAuditId,
  writeReviewFile,
  archiveToHistory,
  readHistory,
} from './audit/writer.js';
import type {
  RuntimeConfig,
  ReviewInput,
  ReviewResult,
  ConfigureInput,
  Mode,
  Severity,
} from './types.js';
import { ROLE_LABELS, MODELS } from './types.js';

// ────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────

let runtimeConfig: RuntimeConfig | null = null;

async function getConfig(): Promise<RuntimeConfig> {
  if (!runtimeConfig) {
    const repoRoot = process.cwd();
    runtimeConfig = await buildRuntimeConfig(repoRoot);
  }
  return runtimeConfig;
}

// ────────────────────────────────────────────────────────────
// MCP Server
// ────────────────────────────────────────────────────────────

const server = new McpServer(
  {
    name: 'tenth-man-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ────────────────────────────────────────────────────────────
// Tool 1: tenth_man_review
// ────────────────────────────────────────────────────────────

server.tool(
  'tenth_man_review',
  `Triggers the 10th Man Protocol — spawns 3 contrarian agents to independently challenge proposed code changes before execution.

Use when:
- Changes touch 3+ files across modules
- Architecture decisions (new patterns, major refactors)
- Auth, security, or data model changes
- DB migrations or schema changes
- Any change where a mistake would be costly

The protocol takes 2-5 minutes depending on agent availability. External agents (Codex, Gemini) run in parallel; Claude subagents run sequentially in isolated context windows.

In STANDARD mode: writes a review file and waits for your verbal approval. After approval, you MUST create an execution plan.
In AUTO mode: returns findings directly — incorporate them into your plan and proceed.`,
  {
    task_description: z.string().describe('What the main agent is about to do'),
    proposed_changes: z.string().describe('The diff, plan, or description of proposed changes'),
    affected_files: z.array(z.string()).describe('File paths being modified'),
    severity: z.enum(['high', 'critical', 'blocker']).describe(
      'high = 3+ files cross-module. critical = architecture/auth/data. blocker = breaking change or data loss risk.',
    ),
    context_files: z.array(z.string()).optional().describe(
      'Additional files the contrarians should read for context',
    ),
    mode: z.enum(['auto', 'standard']).optional().describe(
      'standard = writes review file, waits for approval + plan. auto = returns results, agent proceeds. Default: from config (standard unless changed via tenth_man_configure).',
    ),
  },
  async (args) => {
    const config = await getConfig();
    const start = Date.now();

    // Resolve mode: explicit arg > config default > 'standard'
    const resolvedMode = (args.mode ?? config.default_mode ?? 'standard') as Mode;

    // Ensure infrastructure
    ensureGitignore(config.repo_root);
    ensureDirectories(config.repo_root);
    ensureClaudeMd(config.repo_root);

    const auditId = generateAuditId();
    const input: ReviewInput = {
      task_description: args.task_description,
      proposed_changes: args.proposed_changes,
      affected_files: args.affected_files,
      severity: args.severity as Severity,
      context_files: args.context_files,
      mode: resolvedMode,
    };

    // Resolve which agents to use
    const assignments = resolveAgents(config);
    const agentDescription = describeAgentConfig(assignments);

    // Execute agents
    const { verdicts, subagent_prompts } = await executeAgents(
      assignments,
      input,
      config,
    );

    // Compute consensus from completed agents
    // (Claude subagent verdicts will be added by host agent after spawning)
    const consensus = computeConsensus(verdicts);

    const duration = Date.now() - start;

    // Build summary line for fire-and-forget users
    const summaryLine = `10th Man Protocol: ${consensus.verdict.replace(/_/g, ' ').toUpperCase()} | ${consensus.critical_issues.length} critical issues | ${consensus.recommendations.length} recommendations | ${agentDescription} | ${(duration / 1000).toFixed(1)}s`;

    const result: ReviewResult = {
      audit_id: auditId,
      status: verdicts.some((v) => v.status === 'timeout')
        ? 'partial'
        : verdicts.length > 0
          ? 'completed'
          : 'completed',
      mode: resolvedMode,
      severity: args.severity as Severity,
      duration_ms: duration,
      agents: verdicts,
      consensus,
      subagent_prompts: subagent_prompts.length > 0 ? subagent_prompts : undefined,
      summary_line: summaryLine,
    };

    // ── STANDARD MODE ──────────────────────────────────────
    if (resolvedMode === 'standard') {
      const reviewFile = writeReviewFile(config.repo_root, result, input);
      result.review_file = reviewFile;

      // Build response for host agent
      const agentSummaries = buildAgentSummaries(verdicts, subagent_prompts);
      const subagentInstructions = subagent_prompts.length > 0
        ? buildSubagentInstructions(subagent_prompts)
        : '';

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                status: 'review_complete',
                audit_id: auditId,
                review_file: '.tenth-man/active/REVIEW.md',
                duration_seconds: Math.round(duration / 1000),
                agent_config: agentDescription,
                summary: {
                  verdict: consensus.verdict,
                  confidence: consensus.confidence,
                  critical_issues: consensus.critical_issues,
                  recommendations: consensus.recommendations,
                },
                agent_verdicts: Object.fromEntries(
                  verdicts.map((v) => [
                    v.role,
                    {
                      verdict: v.verdict,
                      confidence: v.confidence,
                      engine: v.engine,
                      model: v.model,
                      status: v.status,
                    },
                  ]),
                ),
                ...(subagent_prompts.length > 0
                  ? {
                      pending_subagents: subagent_prompts.map((s) => ({
                        role: s.role,
                        model: s.model,
                        tools: s.tools,
                        prompt: s.prompt,
                      })),
                    }
                  : {}),
                instruction_to_host: buildStandardInstruction(
                  auditId,
                  agentSummaries,
                  subagent_prompts.length > 0,
                ),
                summary_line: summaryLine,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // ── AUTO MODE ──────────────────────────────────────────
    // Archive immediately in auto mode
    archiveToHistory(config.repo_root, auditId, result, input);

    const subagentInstructions = subagent_prompts.length > 0
      ? buildSubagentInstructions(subagent_prompts)
      : '';

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              status: 'auto_approved',
              audit_id: auditId,
              duration_seconds: Math.round(duration / 1000),
              agent_config: agentDescription,
              summary: {
                verdict: consensus.verdict,
                confidence: consensus.confidence,
                critical_issues: consensus.critical_issues,
                recommendations: consensus.recommendations,
              },
              agent_verdicts: Object.fromEntries(
                verdicts.map((v) => [
                  v.role,
                  {
                    verdict: v.verdict,
                    confidence: v.confidence,
                    engine: v.engine,
                    status: v.status,
                  },
                ]),
              ),
              ...(subagent_prompts.length > 0
                ? {
                    pending_subagents: subagent_prompts.map((s) => ({
                      role: s.role,
                      model: s.model,
                      tools: s.tools,
                      prompt: s.prompt,
                    })),
                  }
                : {}),
              instruction_to_host: buildAutoInstruction(subagent_prompts.length > 0),
              summary_line: summaryLine,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ────────────────────────────────────────────────────────────
// Tool 2: tenth_man_configure
// ────────────────────────────────────────────────────────────

server.tool(
  'tenth_man_configure',
  'Configure agent preferences, timeouts, and trigger patterns for the 10th Man Protocol. Auto-detects available CLI agents if not specified.',
  {
    available_agents: z
      .array(z.enum(['codex', 'gemini']))
      .optional()
      .describe('Which external CLI agents are installed. Auto-detected if omitted.'),
    timeout_seconds: z
      .number()
      .min(30)
      .max(600)
      .optional()
      .describe('Max time per agent before timeout. Default: 180'),
    auto_trigger_patterns: z
      .array(z.string())
      .optional()
      .describe("Glob patterns that always trigger the protocol, e.g. '**/auth/**'"),
    default_mode: z
      .enum(['auto', 'standard'])
      .optional()
      .describe("Default review mode. 'auto' for bypass/YOLO mode (proceeds without asking). 'standard' for interactive (waits for approval). Default: standard"),
  },
  async (args) => {
    const repoRoot = process.cwd();
    const overrides: ConfigureInput = {
      available_agents: args.available_agents as ('codex' | 'gemini')[] | undefined,
      timeout_seconds: args.timeout_seconds,
      auto_trigger_patterns: args.auto_trigger_patterns,
      default_mode: args.default_mode as Mode | undefined,
    };

    // Ensure infrastructure exists
    ensureGitignore(repoRoot);
    ensureDirectories(repoRoot);

    // Persist overrides to .tenth-man/config.json
    const configPath = path.join(repoRoot, '.tenth-man', 'config.json');
    const existing = loadRepoConfig(repoRoot);
    const merged = { ...existing };
    if (overrides.available_agents !== undefined) merged.available_agents = overrides.available_agents;
    if (overrides.timeout_seconds !== undefined) merged.timeout_seconds = overrides.timeout_seconds;
    if (overrides.auto_trigger_patterns !== undefined) merged.auto_trigger_patterns = overrides.auto_trigger_patterns;
    if (overrides.default_mode !== undefined) merged.default_mode = overrides.default_mode;
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n');

    runtimeConfig = await buildRuntimeConfig(repoRoot, overrides);

    const assignments = resolveAgents(runtimeConfig);
    const description = describeAgentConfig(assignments);

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              status: 'configured',
              config: {
                available_agents: [...runtimeConfig.available_agents],
                timeout_seconds: runtimeConfig.timeout_seconds,
                auto_trigger_patterns: runtimeConfig.auto_trigger_patterns,
                default_mode: runtimeConfig.default_mode,
                agent_setup: description,
              },
              models: {
                codex: runtimeConfig.available_agents.has('codex') ? MODELS.codex : 'not available',
                gemini: runtimeConfig.available_agents.has('gemini') ? MODELS.gemini : 'not available',
                claude: MODELS.claude,
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ────────────────────────────────────────────────────────────
// Tool 3: tenth_man_history
// ────────────────────────────────────────────────────────────

server.tool(
  'tenth_man_history',
  'Query past 10th Man audit reports from this repository. Returns recent reviews with verdicts, issues found, and agents used.',
  {
    last_n: z.number().min(1).max(50).default(5).describe('Number of recent audits to return'),
    severity_filter: z
      .enum(['high', 'critical', 'blocker'])
      .optional()
      .describe('Filter by severity level'),
    verdict_filter: z
      .enum(['proceed', 'proceed_with_changes', 'block'])
      .optional()
      .describe('Filter by consensus verdict'),
  },
  async (args) => {
    const config = await getConfig();
    const entries = readHistory(
      config.repo_root,
      args.last_n,
      args.severity_filter as Severity | undefined,
      args.verdict_filter,
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              total: entries.length,
              audits: entries,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

// ────────────────────────────────────────────────────────────
// Helper functions
// ────────────────────────────────────────────────────────────

function buildAgentSummaries(
  verdicts: import('./types.js').AgentVerdict[],
  _pending: import('./types.js').SubagentSpawnInstruction[],
): string {
  const parts: string[] = [];

  for (const v of verdicts) {
    const label = ROLE_LABELS[v.role];
    const engineLabel = v.engine === 'claude'
      ? 'Opus 4.6'
      : `${v.engine.charAt(0).toUpperCase() + v.engine.slice(1)}`;
    parts.push(
      `${label.emoji} ${label.label} (${engineLabel}): ${v.verdict.replace(/_/g, ' ').toUpperCase()} (confidence: ${v.confidence})`,
    );
  }

  return parts.join('\n');
}

function buildSubagentInstructions(
  prompts: import('./types.js').SubagentSpawnInstruction[],
): string {
  return prompts
    .map((p) => {
      const label = ROLE_LABELS[p.role];
      return `Spawn a ${label.label} subagent with model "${p.model}" and tools [${p.tools.join(', ')}]. This subagent must run in its own isolated context — do NOT pass other agents' findings to it.`;
    })
    .join('\n');
}

function buildStandardInstruction(
  auditId: string,
  agentSummaries: string,
  hasSubagents: boolean,
): string {
  let instruction = `10th Man review complete (audit: ${auditId}). Full report: .tenth-man/active/REVIEW.md

Present the summary to the user conversationally. Example:

"10th Man review complete. Here's what the contrarian agents found:

${agentSummaries}

Full report at .tenth-man/active/REVIEW.md — how would you like to proceed?"`;

  if (hasSubagents) {
    instruction += `

IMPORTANT: There are pending subagent spawns listed in "pending_subagents". You MUST spawn ALL of them — not just one. Each one is a different contrarian role (Devil's Advocate, Architecture Critic, Pragmatist). Spawn them one by one as separate Task calls:

For EACH entry in pending_subagents:
1. Create a new Task with model: "opus"
2. Pass the provided prompt verbatim
3. Give tools: Read, Glob, Grep (read-only)
4. Do NOT pass any other agent's output into the Task — each must have ISOLATED context
5. Collect the JSON response from each Task

After ALL subagents have completed, merge their findings into the review, then present the combined results to the user.

Do NOT skip any subagent. Do NOT only run the last one. Every role provides a different critical perspective.`;
  }

  instruction += `

CRITICAL POST-APPROVAL WORKFLOW:
1. Wait for user's verbal decision (approve / reject / approve with notes)
2. After approval: create .tenth-man/active/PLAN.md with a concrete execution plan
   - Address ALL critical issues found by contrarians
   - Note which recommendations you're adopting and which you're skipping (with reasoning)
   - Include phased execution with rollback strategies
   - Incorporate any user notes/overrides
3. Present the plan to the user for confirmation
4. Only begin implementation after plan confirmation
5. After completion, include in your final message:
   "10th Man Protocol: [verdict] | [N] critical issues addressed | Audit: .tenth-man/active/"

Do NOT skip the planning phase. Do NOT proceed directly to code.`;

  return instruction;
}

function buildAutoInstruction(hasSubagents: boolean): string {
  let instruction = `10th Man review complete in AUTO mode.`;

  if (hasSubagents) {
    instruction += `

There are pending subagent spawns listed in "pending_subagents". You MUST spawn ALL of them — not just one. Each is a different contrarian role. Spawn them one by one as separate Task calls with isolated contexts (model: "opus", tools: Read/Glob/Grep, do NOT share outputs between agents).
After ALL subagents complete, merge their findings into your plan.`;
  }

  instruction += `

You MUST still create an internal execution plan before coding:
- Address all critical issues found by the contrarians
- Incorporate relevant recommendations
- Phase the work with rollback points
- Proceed to implementation after planning

After completion, include in your final message:
"10th Man Protocol: [verdict] | [N] critical issues addressed | Audit: .tenth-man/history/"`;

  return instruction;
}

// ────────────────────────────────────────────────────────────
// Start
// ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[tenth-man-mcp] Server started. Awaiting MCP requests via stdio.');
}

main().catch((error) => {
  console.error('[tenth-man-mcp] Fatal error:', error);
  process.exit(1);
});
