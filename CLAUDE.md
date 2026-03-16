# Galileo

Personal AI assistant. NanoClaw fork with knowledge graph memory (Neo4j), local model routing (LM Studio), and Obsidian integration. See [README.md](README.md) for setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process with skill-based channel system. Channels self-register at startup. Messages route to Claude Agent SDK in containers. Before container spawn, relevant memories are recalled from Neo4j (hybrid search). After response, conversations are stored as episodes with entity extraction. The credential proxy can route API calls to local models (LM Studio) or Anthropic based on `GALILEO_ROUTING_MODE`.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |
| `src/galileo/config.ts` | GALILEO_* env var configuration |
| `src/galileo/memory-layer.ts` | Public API: recallMemory + storeMemory |
| `src/galileo/graphiti-client.ts` | Neo4j client: episode CRUD, hybrid search |
| `src/galileo/embeddings.ts` | nomic-embed-text via LM Studio |
| `src/galileo/entity-extractor.ts` | Qwen 9B entity/relationship extraction |
| `src/galileo/decay.ts` | Temporal decay scoring |
| `src/galileo/api-translator.ts` | Anthropic <-> OpenAI API format translation |
| `src/galileo/lmstudio-client.ts` | LM Studio health checks + model listing |
| `src/galileo/router.ts` | Routing toggle (LOCAL_FIRST/LOCAL_ONLY/CLAUDE_ONLY) |
| `src/galileo/obsidian-writer.ts` | Markdown + YAML frontmatter note writer |
| `src/galileo/consolidation.ts` | Nightly consolidation, weekly synthesis, entity sync |
| `scripts/galileo-consolidation.ts` | CLI entry point for consolidation tasks |
| `deploy/galileo-*.plist` | launchd plists for scheduled consolidation |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/setup-galileo` | Configure Neo4j, LM Studio, and Obsidian for Galileo extensions |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.galileo.plist
launchctl unload ~/Library/LaunchAgents/com.galileo.plist
launchctl kickstart -k gui/$(id -u)/com.galileo  # restart

# Linux (systemd)
systemctl --user start galileo
systemctl --user stop galileo
systemctl --user restart galileo
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate channel fork, not bundled in core. Run `/add-whatsapp` (or `git remote add whatsapp https://github.com/qwibitai/nanoclaw-whatsapp.git && git fetch whatsapp main && (git merge whatsapp/main || { git checkout --theirs package-lock.json && git add package-lock.json && git merge --continue; }) && npm run build`) to install it. Existing auth credentials and groups are preserved.

## Learning Loop

After completing a debugging session or significant changes, close the loop:

1. **Save learnings to memory** — Root causes, gotchas, and architectural discoveries go in `~/.claude/projects/-Users-ericverbrugge-Galileo/memory/`. Update existing files before creating new ones. Check `MEMORY.md` index first.
2. **Sync both repos** — Local and Mac Mini must stay in sync. Mac Mini can't push to GitHub. Workflow: `git fetch mini main && git merge mini/main && git push` from local, then `git pull` on Mac Mini.
3. **Rebuild and verify on Mac Mini** — `npm run build` (needs `PATH=/opt/homebrew/bin:$PATH`), restart with `launchctl kickstart`, check `logs/galileo.log` (not `nanoclaw.log`).
4. **Check known issues** — Review memory files for open bugs before starting new work. Current open issue: entity extraction reliability under GPU contention (deferred queue added 2026-03-16, needs validation).

## Quick Smoke Test

Send a test message to the bot via SQLite injection on the Mac Mini to verify end-to-end message processing. Useful after deploying changes to confirm the bot is responsive.

```bash
ssh EricClaw@192.168.68.102 "sqlite3 ~/Galileo/Galileo/store/messages.db \
  \"INSERT OR REPLACE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message) \
  VALUES ('test-\$(date +%s)', 'tg:-5223158323', 'TestHarness', 'Test Harness', '@Galileo Hi, quick health check — respond with OK', '\$(date -u +%Y-%m-%dT%H:%M:%S.000Z)', 0, 0);\""
```

Then watch for the response:
```bash
ssh EricClaw@192.168.68.102 'tail -f ~/Galileo/Galileo/logs/galileo.log' | grep -E 'Agent output|error|warn'
```

For the full integration test suite, see `tests/integration/test-harness.ts`.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
