// ============================================================
// 10th Man Protocol MCP — Result Merger
// ============================================================

import type { AgentVerdict, Consensus, Verdict } from '../types.js';

/**
 * Compute consensus from multiple agent verdicts.
 *
 * Rules:
 * - If ANY agent blocks, overall verdict is "block" unless 2 others strongly disagree
 * - If 2+ agents say "proceed_with_changes", overall is "proceed_with_changes"
 * - If all say "proceed", overall is "proceed"
 * - Confidence is weighted average based on completion status
 */
export function computeConsensus(verdicts: AgentVerdict[]): Consensus {
  const completed = verdicts.filter((v) => v.status === 'completed');

  if (completed.length === 0) {
    return {
      verdict: 'proceed_with_changes',
      confidence: 0.2,
      critical_issues: ['All agents failed or timed out — proceed with extreme caution'],
      recommendations: ['Re-run the protocol or manually review the changes'],
    };
  }

  // Count verdicts
  const counts: Record<Verdict, number> = {
    proceed: 0,
    proceed_with_changes: 0,
    block: 0,
  };

  for (const v of completed) {
    counts[v.verdict]++;
  }

  // Determine overall verdict
  let verdict: Verdict;
  if (counts.block >= 2) {
    verdict = 'block';
  } else if (counts.block === 1 && counts.proceed_with_changes >= 1) {
    // One blocker but others disagree — proceed with changes
    verdict = 'proceed_with_changes';
  } else if (counts.block === 1) {
    // One blocker, no "proceed_with_changes" — still caution
    verdict = 'proceed_with_changes';
  } else if (counts.proceed_with_changes >= 1) {
    verdict = 'proceed_with_changes';
  } else {
    verdict = 'proceed';
  }

  // Weighted confidence
  let totalWeight = 0;
  let weightedConfidence = 0;
  for (const v of completed) {
    const weight = v.status === 'completed' ? 1 : 0.3;
    totalWeight += weight;
    weightedConfidence += v.confidence * weight;
  }
  const confidence = totalWeight > 0
    ? Math.round((weightedConfidence / totalWeight) * 100) / 100
    : 0.5;

  // Extract critical issues from all verdicts
  const critical_issues = extractCriticalIssues(verdicts);
  const recommendations = extractRecommendations(verdicts);

  return { verdict, confidence, critical_issues, recommendations };
}

/**
 * Extract critical issues from agent raw output.
 */
function extractCriticalIssues(verdicts: AgentVerdict[]): string[] {
  const issues: string[] = [];

  for (const v of verdicts) {
    if (!v.raw_output || typeof v.raw_output !== 'object') continue;
    const output = v.raw_output as Record<string, unknown>;

    // Handle different output schemas from different agent roles
    if (Array.isArray(output.critical_issues)) {
      for (const issue of output.critical_issues) {
        if (typeof issue === 'string') {
          issues.push(issue);
        } else if (typeof issue === 'object' && issue !== null) {
          const obj = issue as Record<string, unknown>;
          const title = obj.title ?? obj.description ?? JSON.stringify(issue);
          issues.push(String(title));
        }
      }
    }

    if (Array.isArray(output.structural_issues)) {
      for (const issue of output.structural_issues) {
        if (typeof issue === 'object' && issue !== null) {
          const obj = issue as Record<string, unknown>;
          issues.push(String(obj.title ?? obj.description ?? JSON.stringify(issue)));
        }
      }
    }
  }

  // Deduplicate
  return [...new Set(issues)];
}

/**
 * Extract recommendations from agent raw output.
 */
function extractRecommendations(verdicts: AgentVerdict[]): string[] {
  const recs: string[] = [];

  for (const v of verdicts) {
    if (!v.raw_output || typeof v.raw_output !== 'object') continue;
    const output = v.raw_output as Record<string, unknown>;

    if (Array.isArray(output.recommendations)) {
      for (const rec of output.recommendations) {
        if (typeof rec === 'string') {
          recs.push(rec);
        } else if (typeof rec === 'object' && rec !== null) {
          const obj = rec as Record<string, unknown>;
          recs.push(String(obj.title ?? obj.description ?? JSON.stringify(rec)));
        }
      }
    }

    // Pragmatist phasing suggestions
    if (Array.isArray(output.phasing_suggestion)) {
      for (const phase of output.phasing_suggestion) {
        if (typeof phase === 'object' && phase !== null) {
          const obj = phase as Record<string, unknown>;
          recs.push(`Phase ${obj.phase}: ${obj.title ?? obj.scope}`);
        }
      }
    }
  }

  return [...new Set(recs)];
}
