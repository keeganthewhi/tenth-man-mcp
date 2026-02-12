// ============================================================
// 10th Man Protocol MCP — Type Definitions
// ============================================================

export type Severity = 'high' | 'critical' | 'blocker';
export type Verdict = 'proceed' | 'proceed_with_changes' | 'block';
export type Mode = 'auto' | 'standard';
export type AgentEngine = 'codex' | 'gemini' | 'claude';
export type AgentRole = 'devils_advocate' | 'architecture_critic' | 'pragmatist';

export interface ReviewInput {
  task_description: string;
  proposed_changes: string;
  affected_files: string[];
  severity: Severity;
  context_files?: string[];
  mode?: Mode;
}

export interface ConfigureInput {
  available_agents?: ('codex' | 'gemini')[];
  timeout_seconds?: number;
  auto_trigger_patterns?: string[];
  default_mode?: Mode;
}

export interface HistoryInput {
  last_n?: number;
  severity_filter?: Severity;
  verdict_filter?: Verdict;
}

export interface AgentVerdict {
  role: AgentRole;
  engine: AgentEngine;
  model: string;
  verdict: Verdict;
  confidence: number;
  raw_output: unknown;
  duration_ms: number;
  status: 'completed' | 'timeout' | 'error';
  error?: string;
}

export interface Consensus {
  verdict: Verdict;
  confidence: number;
  critical_issues: string[];
  recommendations: string[];
}

export interface AgentAssignment {
  role: AgentRole;
  engine: AgentEngine;
  model: string;
  via: 'subprocess' | 'subagent_prompt';
}

export interface SubagentSpawnInstruction {
  role: AgentRole;
  model: string;
  prompt: string;
  tools: string[];
}

export interface ReviewResult {
  audit_id: string;
  status: 'completed' | 'timeout' | 'partial';
  mode: Mode;
  severity: Severity;
  duration_ms: number;
  agents: AgentVerdict[];
  consensus: Consensus;
  review_file?: string;
  subagent_prompts?: SubagentSpawnInstruction[];
  summary_line: string;
}

export interface AuditEntry {
  audit_id: string;
  timestamp: string;
  task: string;
  severity: Severity;
  verdict: Verdict;
  agents_used: { role: AgentRole; engine: AgentEngine; model: string }[];
  duration_ms: number;
  mode: Mode;
}

export interface RuntimeConfig {
  available_agents: Set<'codex' | 'gemini'>;
  timeout_seconds: number;
  auto_trigger_patterns: string[];
  default_mode: Mode;
  repo_root: string;
}

export const MODELS = {
  codex: 'gpt-5.3-codex',
  gemini: 'gemini-3-pro-preview',
  claude: 'claude-opus-4-6',
} as const;

export const ROLE_LABELS: Record<AgentRole, { emoji: string; label: string }> = {
  devils_advocate: { emoji: '🔴', label: "Devil's Advocate" },
  architecture_critic: { emoji: '🟡', label: 'Architecture Critic' },
  pragmatist: { emoji: '🟢', label: 'Pragmatist' },
};
