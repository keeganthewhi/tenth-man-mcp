# 10th Man Protocol MCP

> When everyone agrees, someone has to disagree.

Adversarial review system for autonomous AI coding agents. Before your agent executes a critical change, 3 independent contrarian reviewers challenge the proposal — catching what a solo agent misses.

```bash
npm install -g tenth-man-mcp
claude mcp add tenth-man -- npx tenth-man-mcp
```

That's it. On first run, the protocol auto-injects a behavioral trigger into your `CLAUDE.md` and sets up `.tenth-man/` in your repo (gitignored).

## How It Works

When your agent is about to make a critical change — touching auth, refactoring architecture, modifying 3+ files, running migrations — the protocol spawns 3 independent reviewers:

| Agent | Role | What They Do |
|-------|------|-------------|
| 🔴 Devil's Advocate | Break it | Finds every failure mode, race condition, security hole |
| 🟡 Architecture Critic | Question it | Evaluates structural impact, coupling, pattern consistency |
| 🟢 Pragmatist | Reality-check it | Rollback strategy, scope creep, simpler alternatives |

Each agent reads the codebase independently in an **isolated context window**. Zero opinion contamination between reviewers.

## Agent Resolution

The protocol uses the best available models, falling back gracefully:

| Available CLIs | What Happens |
|---|---|
| Codex + Gemini | All 3 run in parallel (~1-3 min) |
| One external agent | External + 2 isolated Claude subagents (~2-4 min) |
| Neither | 3 isolated Claude subagents (~3-5 min) |

**Models**: `gpt-5.3-codex`, `gemini-3-pro-preview`, `claude-opus-4-6`. Top-tier only. This is for people who need reliability over cost.

## Workflow

### Standard Mode (default)

```
Agent detects critical change
    → Calls tenth_man_review
    → "🔟 10th Man Protocol activated — CRITICAL severity.
        Spawning 3 agents... expect 2-5 minutes."
    → Review complete
    → Agent: "3 agents reviewed your JWT refactor:
        🔴 Devil's Advocate BLOCKS — token refresh race condition
        🟡 Architecture Critic says PROCEED — recommends adapter pattern
        🟢 Pragmatist says PROCEED — wants it split into 3 phases
        How would you like to proceed?"
    → You: "go ahead, address the race condition"
    → Agent creates execution plan → you confirm → agent executes
    → Everything archived to .tenth-man/history/
```

### Auto Mode

Same review, no pauses. Agent incorporates findings into its plan and proceeds immediately. For fire-and-forget workflows.

After completion, the agent includes a one-liner:
```
⚠️ 10th Man: Proceed with changes. 2 critical issues addressed, 4 recommendations.
```

## Directory Structure

```
.tenth-man/                     # Auto-added to .gitignore
  config.json                   # Optional repo config
  active/
    REVIEW.md                   # Current review (standard mode)
    PLAN.md                     # Current plan (after approval)
  history/
    2026-02-12T14-30-00Z_a3f8c2/
      review.md
      plan.md
      outcome.json
  index.json                    # Manifest for history queries
```

## Requirements

- Node.js ≥ 20
- Claude Code (host agent)
- Optional: [Codex CLI](https://github.com/openai/codex) for cross-model review
- Optional: [Gemini CLI](https://github.com/google-gemini/gemini-cli) for cross-model review

## Bypass / YOLO Mode

If you run Claude Code with `--dangerously-skip-permissions`, the protocol defaults to **standard** mode (waits for approval) — which means the agent will pause and wait for you. If you're walking away, set auto mode once:

```bash
# In Claude Code, run:
Use tenth_man_configure with default_mode "auto"
```

Or create `.tenth-man/config.json` in your repo:

```json
{
  "default_mode": "auto"
}
```

Now the protocol reviews, plans internally, executes, and archives — no pauses. You come back to finished work + full audit trail.

> **Why not auto-detect?** Claude Code [cannot detect](https://github.com/anthropics/claude-code/issues/17603) whether it's running in bypass mode. It always thinks it's interactive. So this is a one-time config per repo.

---

## Reference

### MCP Tools

#### `tenth_man_review`

Main entry point. Triggers adversarial review.

```json
{
  "task_description": "Refactor auth from session-based to JWT",
  "proposed_changes": "Replace express-session with jsonwebtoken...",
  "affected_files": ["src/auth/*", "src/middleware/auth.ts"],
  "severity": "critical",
  "mode": "standard"
}
```

**Severity levels:**
- `high` — 3+ files affected
- `critical` — Auth, data, architecture changes
- `blocker` — Breaking changes, migrations

**Modes:**
- `standard` — Review → user approval → plan → user confirms → execute
- `auto` — Review → agent plans internally → execute → audit trail

#### `tenth_man_compile`

Finalizes review after Claude subagent results are collected. Called automatically by the host agent after spawning subagents.

#### `tenth_man_configure`

View or update repo-level settings.

```json
{
  "timeout_seconds": 240,
  "default_mode": "auto",
  "available_agents": ["codex"]
}
```

#### `tenth_man_history`

Query past audits.

```json
{
  "last_n": 10,
  "severity": "critical"
}
```

### Configuration

Optional `.tenth-man/config.json`:

```json
{
  "available_agents": ["codex", "gemini"],
  "timeout_seconds": 180,
  "default_mode": "standard",
  "auto_trigger_patterns": [
    "**/auth/**",
    "**/migrations/**",
    "**/*.schema.*"
  ]
}
```

## License

MIT
