// ============================================================
// 10th Man Protocol MCP — Configuration & Agent Detection
// ============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RuntimeConfig, ConfigureInput } from '../types.js';

const execFileAsync = promisify(execFile);

/**
 * Detect which external CLI agents are available on the system.
 * Non-blocking — if a CLI doesn't exist, we skip it silently.
 */
export async function detectAgents(): Promise<Set<'codex' | 'gemini'>> {
  const available = new Set<'codex' | 'gemini'>();

  const checks = [
    { name: 'codex' as const, cmd: 'npx', args: ['codex', '--version'] },
    { name: 'gemini' as const, cmd: 'gemini', args: ['--version'] },
  ];

  const results = await Promise.allSettled(
    checks.map(async ({ name, cmd, args }) => {
      try {
        await execFileAsync(cmd, args, { timeout: 10_000 });
        return name;
      } catch {
        return null;
      }
    }),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      available.add(result.value);
    }
  }

  return available;
}

/**
 * Load repo-level config from .tenth-man/config.json if it exists.
 */
export function loadRepoConfig(repoRoot: string): Partial<ConfigureInput> {
  const configPath = path.join(repoRoot, '.tenth-man', 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw) as Partial<ConfigureInput>;
    }
  } catch {
    // Malformed config — ignore silently
  }
  return {};
}

/**
 * Ensure .tenth-man/ is in .gitignore. Idempotent.
 */
export function ensureGitignore(repoRoot: string): void {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const entry = '.tenth-man/';

  try {
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes(entry)) {
        fs.appendFileSync(
          gitignorePath,
          `\n# 10th Man Protocol audit files\n${entry}\n`,
        );
      }
    } else {
      fs.writeFileSync(
        gitignorePath,
        `# 10th Man Protocol audit files\n${entry}\n`,
      );
    }
  } catch {
    // Can't write .gitignore — not fatal, just log
    console.error('[tenth-man] Warning: Could not update .gitignore');
  }
}

/**
 * Ensure the .tenth-man/ directory structure exists.
 */
export function ensureDirectories(repoRoot: string): void {
  const dirs = [
    path.join(repoRoot, '.tenth-man'),
    path.join(repoRoot, '.tenth-man', 'active'),
    path.join(repoRoot, '.tenth-man', 'history'),
  ];

  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Build runtime config from defaults + repo config + user overrides.
 */
export async function buildRuntimeConfig(
  repoRoot: string,
  userOverrides?: ConfigureInput,
): Promise<RuntimeConfig> {
  const repoConfig = loadRepoConfig(repoRoot);
  const detected = await detectAgents();

  // User overrides > repo config > auto-detection
  const agents = userOverrides?.available_agents
    ?? repoConfig.available_agents
    ?? [...detected];

  return {
    available_agents: new Set(agents as ('codex' | 'gemini')[]),
    timeout_seconds: userOverrides?.timeout_seconds
      ?? repoConfig.timeout_seconds
      ?? 180,
    auto_trigger_patterns: userOverrides?.auto_trigger_patterns
      ?? repoConfig.auto_trigger_patterns
      ?? ['**/auth/**', '**/migrations/**', '**/*.schema.*'],
    default_mode: userOverrides?.default_mode
      ?? repoConfig.default_mode
      ?? 'standard',
    repo_root: repoRoot,
  };
}
