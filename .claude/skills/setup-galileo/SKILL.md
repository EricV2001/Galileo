---
name: setup-galileo
description: Configure Neo4j, LM Studio, and Obsidian for Galileo extensions. Run after /setup to enable knowledge graph memory, local model routing, and Obsidian integration.
---

# Galileo Extensions Setup

Configure Galileo's three extensions: knowledge graph memory (Neo4j), local model routing (LM Studio), and Obsidian integration.

**Run after `/setup` has completed** (or invoked automatically from step 9 of `/setup`).

**Principle:** Same as `/setup` — fix what you can, only pause for genuine user actions.

**UX Note:** Use `AskUserQuestion` for all user-facing questions. If `.env.example` exists, reference it so users can see all available variables.

## 1. Check .env Configuration

Read `.env` and check for GALILEO_* variables. If missing, ask the user for:

1. **Neo4j credentials** — `GALILEO_NEO4J_URI`, `GALILEO_NEO4J_USER`, `GALILEO_NEO4J_PASSWORD`
   - Default URI: `bolt://localhost:7687`
   - Ask: "What are your Neo4j credentials? (default: neo4j/neo4j on localhost:7687)"

2. **LM Studio URL** — `GALILEO_LMSTUDIO_URL`
   - Ask: "What is your LM Studio URL? (default: http://localhost:1234/v1 — LMLink makes remote models appear local)"

3. **Model names** — `GALILEO_MODEL_GENERAL`, `GALILEO_MODEL_EXTRACTION`, `GALILEO_MODEL_EMBEDDING`
   - Suggest defaults: qwen3.5-27b, qwen3.5-9b, text-embedding-nomic-embed-text-v1.5@f16

4. **Obsidian vault path** — `GALILEO_OBSIDIAN_VAULT_PATH`
   - Ask: "Where is your Obsidian vault? (leave empty to skip Obsidian integration)"

5. **Enable memory** — `GALILEO_MEMORY_ENABLED=true`

Write all values to `.env` (append, don't overwrite existing content).

## 2. Verify Neo4j

Run: `npx tsx setup/index.ts --step neo4j`

Parse the status block. If failed:
- Check if Neo4j is running: suggest `docker run -d -p 7687:7687 -p 7474:7474 -e NEO4J_AUTH=neo4j/<password> neo4j:5`
- Ask user to verify credentials and retry

## 3. Verify LM Studio

Run: `npx tsx setup/index.ts --step lm-studio`

Parse the status block. If failed:
- Check if LM Studio / LMLink is running
- Verify the URL is correct
- Note: LM Studio is optional for CLAUDE_ONLY mode

Report which models are available.

## 4. Setup Obsidian

Run: `npx tsx setup/index.ts --step obsidian`

Parse the status block. If skipped (no vault path), note this is optional.
If failed, help debug the path.

## 5. Install Consolidation Services (macOS only)

If GALILEO_OBSIDIAN_VAULT_PATH is set AND the platform is macOS, offer to install the launchd services for automated consolidation.

AskUserQuestion: "Would you like to install the scheduled consolidation services? These run automatically via launchd:
- **Daily consolidation** (3:00 AM) — summarizes the day's conversations
- **Weekly synthesis** (Sundays 4:00 AM) — cross-conversation insights
- **Entity sync** (3:15 AM daily) — exports entities to your Obsidian vault"

If yes:

First, read the plist files and replace placeholders with actual values:

```bash
PROJECT_ROOT=$(pwd)
NODE_PATH=$(which node)
HOME_DIR=$HOME

for plist in deploy/galileo-consolidate.plist deploy/galileo-synthesize.plist deploy/galileo-entity-sync.plist; do
  BASENAME=$(basename "$plist")
  LABEL=$(echo "$BASENAME" | sed 's/\.plist//')
  DEST="$HOME/Library/LaunchAgents/com.${LABEL}.plist"
  sed -e "s|{{PROJECT_ROOT}}|${PROJECT_ROOT}|g" \
      -e "s|{{NODE_PATH}}|${NODE_PATH}|g" \
      -e "s|{{HOME}}|${HOME_DIR}|g" \
      "$plist" > "$DEST"
  launchctl load "$DEST"
done
```

Create the log directory:
```bash
mkdir -p ~/Library/Logs/Galileo
```

Verify all three are loaded:
```bash
launchctl list | grep galileo
```

If not macOS: Tell user consolidation can be run manually via `npx tsx scripts/galileo-consolidation.ts daily|weekly|entities`, or set up equivalent cron jobs.

## 6. Summary

Report status of all components:
- Neo4j: connected / failed
- LM Studio: connected (N models) / failed / skipped
- Obsidian: configured / skipped
- Consolidation services: installed / skipped

If Neo4j is connected and GALILEO_MEMORY_ENABLED is not already `true`:
- Set it: append `GALILEO_MEMORY_ENABLED=true` to `.env`
- Announce: "Knowledge graph memory is now active."

If all components are configured: "Galileo is fully configured. Restart the main service to pick up the new settings:"
- macOS: `launchctl kickstart -k gui/$(id -u)/com.galileo`
- Linux: `systemctl --user restart galileo`
