---
name: setup-galileo
description: Configure Neo4j, LM Studio, and Obsidian for Galileo extensions. Run after /setup to enable knowledge graph memory, local model routing, and Obsidian integration.
---

# Galileo Setup

Configure Galileo's three extensions: knowledge graph memory (Neo4j), local model routing (LM Studio), and Obsidian integration.

**Run after `/setup` has completed.**

## 1. Check .env Configuration

Read `.env` and check for GALILEO_* variables. If missing, ask the user for:

1. **Neo4j credentials** — `GALILEO_NEO4J_URI`, `GALILEO_NEO4J_USER`, `GALILEO_NEO4J_PASSWORD`
   - Default URI: `bolt://localhost:7687`
   - Ask: "What are your Neo4j credentials? (default: neo4j/neo4j on localhost:7687)"

2. **LM Studio URL** — `GALILEO_LMSTUDIO_URL`
   - Ask: "What is your LM Studio URL? (e.g., http://192.168.1.100:1234/v1)"

3. **Model names** — `GALILEO_MODEL_GENERAL`, `GALILEO_MODEL_EXTRACTION`, `GALILEO_MODEL_EMBEDDING`
   - Suggest defaults: qwen3.5-27b, qwen3.5-9b, nomic-embed-text-v1.5

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

## 5. Summary

Report status of all three components:
- Neo4j: connected / failed
- LM Studio: connected (N models) / failed / skipped
- Obsidian: configured / skipped

If Neo4j is connected, announce: "Knowledge graph memory is ready. Set GALILEO_MEMORY_ENABLED=true in .env to activate."
