// ============================================================
// 10th Man Protocol MCP — Audit Writer
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  ReviewResult,
  AgentVerdict,
  AuditEntry,
  Severity,
  Verdict,
} from '../types.js';
import { ROLE_LABELS } from '../types.js';

/**
 * Generate a short audit ID.
 */
export function generateAuditId(): string {
  return Math.random().toString(36).substring(2, 8);
}

/**
 * Write the review markdown file to .tenth-man/active/REVIEW.md
 */
export function writeReviewFile(
  repoRoot: string,
  result: ReviewResult,
  input: { task_description: string; severity: Severity },
): string {
  const filePath = path.join(repoRoot, '.tenth-man', 'active', 'REVIEW.md');

  const verdictEmoji: Record<Verdict, string> = {
    proceed: '✅',
    proceed_with_changes: '⚠️',
    block: '🛑',
  };

  let content = `# 10th Man Protocol — Review Report

> **Review the findings below, then tell your agent how to proceed.**

**Audit ID**: ${result.audit_id}
**Date**: ${new Date().toISOString()}
**Task**: ${input.task_description}
**Severity**: ${input.severity.toUpperCase()}
**Duration**: ${(result.duration_ms / 1000).toFixed(1)}s
**Agents**: ${result.agents.length} completed, ${result.subagent_prompts?.length ?? 0} pending subagent

---

## Agent Reports
`;

  // Completed external agent reports
  for (const agent of result.agents) {
    const label = ROLE_LABELS[agent.role];
    const engineLabel = agent.engine === 'claude'
      ? `Opus 4.6`
      : `${agent.engine.charAt(0).toUpperCase() + agent.engine.slice(1)} · ${agent.model}`;

    content += `
### ${label.emoji} ${label.label} (${engineLabel})
**Verdict: ${agent.verdict.toUpperCase().replace(/_/g, ' ')}** · Confidence: ${agent.confidence}
**Status**: ${agent.status}${agent.duration_ms ? ` · ${(agent.duration_ms / 1000).toFixed(1)}s` : ''}
`;

    if (agent.error) {
      content += `\n**Error**: ${agent.error}\n`;
    }

    if (agent.raw_output && typeof agent.raw_output === 'object') {
      const output = agent.raw_output as Record<string, unknown>;

      // Reasoning
      if (output.reasoning) {
        content += `\n${output.reasoning}\n`;
      }

      // Critical issues
      if (Array.isArray(output.critical_issues) && output.critical_issues.length > 0) {
        content += `\n**Critical Issues:**\n`;
        for (const issue of output.critical_issues) {
          if (typeof issue === 'string') {
            content += `- ${issue}\n`;
          } else if (typeof issue === 'object' && issue !== null) {
            const obj = issue as Record<string, unknown>;
            content += `- **${obj.title ?? 'Issue'}**: ${obj.description ?? JSON.stringify(issue)}\n`;
          }
        }
      }

      // Structural issues (architecture critic)
      if (Array.isArray(output.structural_issues) && output.structural_issues.length > 0) {
        content += `\n**Structural Issues:**\n`;
        for (const issue of output.structural_issues) {
          if (typeof issue === 'object' && issue !== null) {
            const obj = issue as Record<string, unknown>;
            content += `- **${obj.title ?? 'Issue'}** (${obj.impact ?? 'general'}): ${obj.description ?? ''}\n`;
          }
        }
      }

      // Recommendations
      if (Array.isArray(output.recommendations) && output.recommendations.length > 0) {
        content += `\n**Recommendations:**\n`;
        for (const rec of output.recommendations) {
          if (typeof rec === 'string') {
            content += `- ${rec}\n`;
          } else if (typeof rec === 'object' && rec !== null) {
            const obj = rec as Record<string, unknown>;
            content += `- ${obj.title ?? obj.description ?? JSON.stringify(rec)}\n`;
          }
        }
      }

      // Assessment (pragmatist)
      if (output.assessment && typeof output.assessment === 'object') {
        const assessment = output.assessment as Record<string, unknown>;
        content += `\n**Assessment:**\n`;
        content += `- Justified: ${assessment.justified ?? 'N/A'}\n`;
        content += `- Complexity: ${assessment.complexity_rating ?? 'N/A'}\n`;
        if (assessment.simpler_alternative) {
          content += `- Simpler alternative: ${assessment.simpler_alternative}\n`;
        }
      }

      // Phasing suggestion
      if (Array.isArray(output.phasing_suggestion) && output.phasing_suggestion.length > 0) {
        content += `\n**Phasing Suggestion:**\n`;
        for (const phase of output.phasing_suggestion) {
          if (typeof phase === 'object' && phase !== null) {
            const obj = phase as Record<string, unknown>;
            content += `- Phase ${obj.phase}: ${obj.title ?? obj.scope ?? ''}\n`;
          }
        }
      }
    }

    content += `\n---\n`;
  }

  // Pending subagent reports
  if (result.subagent_prompts && result.subagent_prompts.length > 0) {
    for (const prompt of result.subagent_prompts) {
      const label = ROLE_LABELS[prompt.role];
      content += `
### ${label.emoji} ${label.label} (Opus 4.6 · subagent)
**Status**: PENDING — awaiting host agent to spawn subagent with isolated context

---
`;
    }
  }

  // Consensus
  content += `
## Consensus
- **Verdict**: ${verdictEmoji[result.consensus.verdict]} ${result.consensus.verdict.toUpperCase().replace(/_/g, ' ')}
- **Confidence**: ${result.consensus.confidence}
- **Critical Issues**: ${result.consensus.critical_issues.length}${result.consensus.critical_issues.length > 0 ? ' (must address)' : ''}
- **Recommendations**: ${result.consensus.recommendations.length}

---
*Generated by [tenth-man-mcp](https://github.com/tenth-man-mcp) · ${new Date().toISOString()} · Duration: ${(result.duration_ms / 1000).toFixed(1)}s*
`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

/**
 * Archive active review/plan files to history directory.
 */
export function archiveToHistory(
  repoRoot: string,
  auditId: string,
  result: ReviewResult,
  input: { task_description: string; severity: Severity },
): void {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const historyDir = path.join(repoRoot, '.tenth-man', 'history', `${timestamp}_${auditId}`);

  fs.mkdirSync(historyDir, { recursive: true });

  // Move active files if they exist
  const activeDir = path.join(repoRoot, '.tenth-man', 'active');
  const reviewFile = path.join(activeDir, 'REVIEW.md');
  const planFile = path.join(activeDir, 'PLAN.md');

  if (fs.existsSync(reviewFile)) {
    fs.copyFileSync(reviewFile, path.join(historyDir, 'review.md'));
    fs.unlinkSync(reviewFile);
  }

  if (fs.existsSync(planFile)) {
    fs.copyFileSync(planFile, path.join(historyDir, 'plan.md'));
    fs.unlinkSync(planFile);
  }

  // Write outcome.json
  const outcome = {
    audit_id: auditId,
    timestamp: new Date().toISOString(),
    task: input.task_description,
    severity: input.severity,
    verdict: result.consensus.verdict,
    confidence: result.consensus.confidence,
    critical_issues: result.consensus.critical_issues,
    recommendations: result.consensus.recommendations,
    agents_used: result.agents.map((a) => ({
      role: a.role,
      engine: a.engine,
      model: a.model,
      verdict: a.verdict,
      status: a.status,
    })),
    duration_ms: result.duration_ms,
    mode: result.mode,
  };

  fs.writeFileSync(
    path.join(historyDir, 'outcome.json'),
    JSON.stringify(outcome, null, 2),
    'utf-8',
  );

  // Update index
  updateIndex(repoRoot, {
    audit_id: auditId,
    timestamp: new Date().toISOString(),
    task: input.task_description,
    severity: input.severity,
    verdict: result.consensus.verdict,
    agents_used: result.agents.map((a) => ({
      role: a.role,
      engine: a.engine,
      model: a.model,
    })),
    duration_ms: result.duration_ms,
    mode: result.mode,
  });
}

/**
 * Update the index.json manifest.
 */
function updateIndex(repoRoot: string, entry: AuditEntry): void {
  const indexPath = path.join(repoRoot, '.tenth-man', 'index.json');
  let index: AuditEntry[] = [];

  try {
    if (fs.existsSync(indexPath)) {
      index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    }
  } catch {
    index = [];
  }

  index.unshift(entry); // Newest first

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Read audit history from index.json.
 */
export function readHistory(
  repoRoot: string,
  lastN: number = 5,
  severityFilter?: Severity,
  verdictFilter?: Verdict,
): AuditEntry[] {
  const indexPath = path.join(repoRoot, '.tenth-man', 'index.json');

  try {
    if (!fs.existsSync(indexPath)) return [];
    let entries: AuditEntry[] = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

    if (severityFilter) {
      entries = entries.filter((e) => e.severity === severityFilter);
    }
    if (verdictFilter) {
      entries = entries.filter((e) => e.verdict === verdictFilter);
    }

    return entries.slice(0, lastN);
  } catch {
    return [];
  }
}
