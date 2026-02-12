import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLAUDE_MD_MARKER = '## 10th Man Protocol';

const CLAUDE_MD_SNIPPET = `
## 10th Man Protocol
Before implementing changes that affect 3+ files, touch auth/security/data layers, or involve breaking changes, ALWAYS call the \`tenth_man_review\` MCP tool first.
When the tool returns \`pending_subagents\`, you MUST spawn ALL of them as separate Task calls with isolated contexts — do not skip any agent, each provides a different critical perspective.
After review in standard mode: present findings to the user and wait for approval before creating an execution plan. In auto mode: incorporate findings into your plan and proceed.
`;

export function ensureClaudeMd(repoRoot: string): void {
  const claudeMdPath = join(repoRoot, 'CLAUDE.md');

  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, 'utf-8');
    if (!content.includes(CLAUDE_MD_MARKER)) {
      writeFileSync(claudeMdPath, content.trimEnd() + '\n' + CLAUDE_MD_SNIPPET);
    }
  } else {
    writeFileSync(claudeMdPath, CLAUDE_MD_SNIPPET.trimStart());
  }
}
