import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ensureClaudeMd } from './claude-md.js';

const TENTH_MAN_DIR = '.tenth-man';
const GITIGNORE_ENTRY = '.tenth-man/';

export function ensureGitignore(repoRoot: string): void {
  const gitignorePath = join(repoRoot, '.gitignore');

  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, 'utf-8');
    if (!content.includes(GITIGNORE_ENTRY)) {
      writeFileSync(
        gitignorePath,
        content.trimEnd() + '\n\n# 10th Man Protocol audit files\n' + GITIGNORE_ENTRY + '\n'
      );
    }
  } else {
    writeFileSync(
      gitignorePath,
      '# 10th Man Protocol audit files\n' + GITIGNORE_ENTRY + '\n'
    );
  }
}

export function ensureDirectories(repoRoot: string): void {
  const dirs = [
    join(repoRoot, TENTH_MAN_DIR),
    join(repoRoot, TENTH_MAN_DIR, 'active'),
    join(repoRoot, TENTH_MAN_DIR, 'history'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function initRepo(repoRoot: string): void {
  ensureGitignore(repoRoot);
  ensureDirectories(repoRoot);
  ensureClaudeMd(repoRoot);
}
