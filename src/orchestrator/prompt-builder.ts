// ============================================================
// 10th Man Protocol MCP — Prompt Builder
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRole, ReviewInput } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPT_DIR = path.join(__dirname, '..', 'prompts');

// Cache templates in memory
const templateCache = new Map<AgentRole, string>();

const ROLE_TO_FILE: Record<AgentRole, string> = {
  devils_advocate: 'devils-advocate.md',
  architecture_critic: 'architecture-critic.md',
  pragmatist: 'pragmatist.md',
};

function loadTemplate(role: AgentRole): string {
  if (templateCache.has(role)) {
    return templateCache.get(role)!;
  }

  // Try compiled dist path first, then source path
  const candidates = [
    path.join(PROMPT_DIR, ROLE_TO_FILE[role]),
    path.join(__dirname, '..', '..', 'src', 'prompts', ROLE_TO_FILE[role]),
  ];

  for (const candidate of candidates) {
    try {
      const content = fs.readFileSync(candidate, 'utf-8');
      templateCache.set(role, content);
      return content;
    } catch {
      continue;
    }
  }

  // Fallback: inline minimal prompt
  return getFallbackPrompt(role);
}

function getFallbackPrompt(role: AgentRole): string {
  const roleLabels: Record<AgentRole, string> = {
    devils_advocate: "Devil's Advocate — find every way this change can fail",
    architecture_critic: 'Architecture Critic — evaluate structural/architectural impact',
    pragmatist: 'Pragmatist — cost-benefit analysis, is this worth the complexity',
  };

  return `You are the ${roleLabels[role]} in the 10th Man Protocol.

You have NO knowledge of what other reviewers think. You are the ONLY reviewer.

Analyze the proposed changes and respond in JSON format with:
- verdict: "proceed" | "proceed_with_changes" | "block"
- confidence: 0.0-1.0
- critical_issues: array of issues found
- recommendations: array of suggestions
- reasoning: 2-3 sentence summary

Task: {{task_description}}
Proposed Changes: {{proposed_changes}}
Affected Files: {{affected_files}}
Context: {{context_files}}`;
}

/**
 * Build a complete prompt for a specific contrarian role.
 */
export function buildPrompt(role: AgentRole, input: ReviewInput): string {
  let template = loadTemplate(role);

  const replacements: Record<string, string> = {
    '{{task_description}}': input.task_description,
    '{{proposed_changes}}': input.proposed_changes,
    '{{affected_files}}': input.affected_files.join('\n'),
    '{{context_files}}': input.context_files?.join('\n') ?? '(none provided)',
  };

  for (const [placeholder, value] of Object.entries(replacements)) {
    template = template.replaceAll(placeholder, value);
  }

  return template;
}

/**
 * Build a prompt wrapped with explicit JSON-only output instruction.
 * Used for subprocess invocations where we need parseable output.
 */
export function buildStructuredPrompt(role: AgentRole, input: ReviewInput): string {
  const base = buildPrompt(role, input);
  return `${base}

IMPORTANT: Respond ONLY with valid JSON. No markdown fences, no preamble, no explanation outside the JSON structure. The response must start with { and end with }.`;
}
