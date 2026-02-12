// ============================================================
// 10th Man Protocol MCP — Agent Invoker
// ============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  AgentAssignment,
  AgentVerdict,
  AgentRole,
  ReviewInput,
  RuntimeConfig,
  SubagentSpawnInstruction,
} from '../types.js';
import { MODELS, ROLE_LABELS } from '../types.js';
import { buildPrompt, buildStructuredPrompt } from './prompt-builder.js';

const execFileAsync = promisify(execFile);

const VALID_VERDICTS = new Set(['proceed', 'proceed_with_changes', 'block']);
function isVerdict(v: unknown): v is import('../types.js').Verdict {
  return typeof v === 'string' && VALID_VERDICTS.has(v);
}

/**
 * Invoke an external CLI agent (Codex or Gemini) as a subprocess.
 */
async function invokeExternal(
  assignment: AgentAssignment,
  input: ReviewInput,
  config: RuntimeConfig,
): Promise<AgentVerdict> {
  const start = Date.now();
  const prompt = buildStructuredPrompt(assignment.role, input);

  let cmd: string;
  let args: string[];

  if (assignment.engine === 'codex') {
    cmd = 'npx';
    args = [
      'codex', 'exec',
      '--model', MODELS.codex,
      '--model-reasoning-effort', 'high',
      '-q', prompt,
    ];
  } else if (assignment.engine === 'gemini') {
    cmd = 'gemini';
    args = [
      '-p', prompt,
      '--model', MODELS.gemini,
      '--output-format', 'json',
      '--sandbox',
    ];
  } else {
    throw new Error(`Unsupported external engine: ${assignment.engine}`);
  }

  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      cwd: config.repo_root,
      timeout: config.timeout_seconds * 1000,
      env: { ...process.env, CI: 'true' },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    const duration = Date.now() - start;
    const parsed = parseAgentOutput(stdout, assignment.role);

    return {
      role: assignment.role,
      engine: assignment.engine,
      model: assignment.model,
      verdict: isVerdict(parsed.verdict) ? parsed.verdict : 'proceed_with_changes',
      confidence: (typeof parsed.confidence === 'number' ? parsed.confidence : 0.5),
      raw_output: parsed,
      duration_ms: duration,
      status: 'completed',
    };
  } catch (err: unknown) {
    const duration = Date.now() - start;
    const error = err as Error & { killed?: boolean; code?: string };

    return {
      role: assignment.role,
      engine: assignment.engine,
      model: assignment.model,
      verdict: 'proceed_with_changes',
      confidence: 0.3,
      raw_output: null,
      duration_ms: duration,
      status: error.killed ? 'timeout' : 'error',
      error: error.killed
        ? `Agent timed out after ${config.timeout_seconds}s`
        : `Agent failed: ${error.message}`,
    };
  }
}

/**
 * Parse agent output — handles JSON with or without markdown fences.
 */
function parseAgentOutput(
  output: string,
  role: AgentRole,
): Record<string, unknown> {
  const cleaned = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract JSON from mixed output
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fall through
      }
    }

    // Unparseable — wrap the raw text as a finding
    return {
      verdict: 'proceed_with_changes',
      confidence: 0.4,
      reasoning: `[${ROLE_LABELS[role].label}] Raw output (could not parse as JSON): ${output.slice(0, 500)}`,
      critical_issues: [],
      recommendations: [],
    };
  }
}

/**
 * Build a subagent spawn instruction for Claude Code's Task tool.
 * This is returned to the host agent — the MCP does NOT invoke Claude directly.
 */
function buildSubagentInstruction(
  assignment: AgentAssignment,
  input: ReviewInput,
): SubagentSpawnInstruction {
  const prompt = buildPrompt(assignment.role, input);

  return {
    role: assignment.role,
    model: 'opus',
    prompt,
    tools: ['Read', 'Glob', 'Grep'], // Read-only repo access
  };
}

/**
 * Execute all agent assignments.
 * External agents run as subprocesses (parallel).
 * Claude subagents are returned as spawn instructions for the host.
 */
export async function executeAgents(
  assignments: AgentAssignment[],
  input: ReviewInput,
  config: RuntimeConfig,
): Promise<{
  verdicts: AgentVerdict[];
  subagent_prompts: SubagentSpawnInstruction[];
}> {
  const externalAssignments = assignments.filter((a) => a.via === 'subprocess');
  const claudeAssignments = assignments.filter((a) => a.via === 'subagent_prompt');

  // Run external agents in parallel
  const externalResults = await Promise.allSettled(
    externalAssignments.map((a) => invokeExternal(a, input, config)),
  );

  const verdicts: AgentVerdict[] = externalResults.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // Promise.allSettled rejection — shouldn't happen since invokeExternal catches internally
    return {
      role: externalAssignments[i].role,
      engine: externalAssignments[i].engine,
      model: externalAssignments[i].model,
      verdict: 'proceed_with_changes' as const,
      confidence: 0.3,
      raw_output: null,
      duration_ms: 0,
      status: 'error' as const,
      error: `Unexpected failure: ${(result as PromiseRejectedResult).reason}`,
    };
  });

  // Build subagent instructions for Claude agents
  const subagent_prompts = claudeAssignments.map((a) =>
    buildSubagentInstruction(a, input),
  );

  return { verdicts, subagent_prompts };
}
