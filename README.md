# Galileo

A personal AI assistant with knowledge graph memory, local model routing, and Obsidian integration. Built on [NanoClaw](https://github.com/qwibitai/nanoclaw) — agents run securely in their own containers via the Claude Agent SDK.

## What Galileo Adds

Galileo extends NanoClaw with three features ported from [Galileo1](https://github.com/EricV2001/Galileo1) (Python predecessor):

- **Knowledge Graph Memory** (Neo4j) — Hybrid search (vector + full-text + graph traversal) with temporal decay scoring. Conversations are stored as episodes with entity extraction via local LLM.
- **Local Model Routing** (LM Studio) — Route agent requests to local models (Qwen 3.5 27B) via credential proxy translation. Local models get full agent capabilities: tools, MCP, bash, browser. Toggle: `LOCAL_FIRST` / `LOCAL_ONLY` / `CLAUDE_ONLY`.
- **Obsidian Integration** — Nightly consolidation, weekly synthesis, and entity sync to your Obsidian vault via launchd. Uses local models for summarization.

All Galileo code lives in `src/galileo/` for clean upstream merges.

## Quick Start

```bash
git clone https://github.com/EricV2001/Galileo.git
cd Galileo
claude
```

Then run `/setup` for base NanoClaw setup, followed by `/setup-galileo` to configure Neo4j, LM Studio, and Obsidian.

> **Note:** Commands prefixed with `/` are [Claude Code skills](https://code.claude.com/docs/en/skills). Type them inside the `claude` CLI prompt, not in your regular terminal.

## Hardware Setup

| Component | Purpose |
|-----------|---------|
| Mac Mini | Runs Galileo (NanoClaw host process + containers) |
| Mac Studio | Serves models via [LMLink](https://lmstudio.ai) to Mac Mini |

### Model Tiers

| Role | Model | Purpose |
|------|-------|---------|
| General agent | Qwen 3.5 27B (6-bit MLX) | Main agent tasks, consolidation, synthesis |
| Entity extraction | Qwen 3.5 9B | Lightweight structured extraction for knowledge graph |
| Embeddings | nomic-embed-text v1.5 (0.3 GB) | Vector search in Neo4j — always loaded |
| Fallback | Claude Sonnet / Opus | Complex reasoning when local quality isn't enough |

## Features

### From NanoClaw (base)
- **Multi-channel messaging** — WhatsApp, Telegram, Discord, Slack, Gmail via skills
- **Container isolation** — Agents sandboxed in Apple Container (macOS) or Docker
- **Isolated group context** — Each group has its own `CLAUDE.md` memory and filesystem
- **Scheduled tasks** — Recurring jobs that run agents and can message back
- **Web access** — Search and fetch content from the web
- **Agent Swarms** — Teams of specialized agents collaborating on tasks

### From Galileo (extensions)
- **Knowledge graph memory** — Neo4j-backed episode storage with hybrid search
- **Entity extraction** — Automatic extraction of people, projects, concepts via Qwen 9B
- **Temporal decay** — Recent memories scored higher than old ones (30-day half-life)
- **Local model routing** — Run Qwen 3.5 27B with full agent capabilities via credential proxy
- **Obsidian sync** — Daily digests, entity notes, weekly synthesis to your vault

## Configuration

Galileo-specific settings in `.env`:

```env
# Routing (controls credential proxy behavior)
GALILEO_ROUTING_MODE=LOCAL_FIRST          # LOCAL_FIRST | LOCAL_ONLY | CLAUDE_ONLY

# LM Studio (via LMLink)
GALILEO_LMSTUDIO_URL=http://<mac-studio-ip>:1234/v1
GALILEO_MODEL_GENERAL=qwen3.5-27b
GALILEO_MODEL_EXTRACTION=qwen3.5-9b
GALILEO_MODEL_EMBEDDING=nomic-embed-text-v1.5

# Memory (Neo4j)
GALILEO_MEMORY_ENABLED=true
GALILEO_NEO4J_URI=bolt://localhost:7687
GALILEO_NEO4J_USER=neo4j
GALILEO_NEO4J_PASSWORD=your-password
GALILEO_MAX_RECALL_RESULTS=5
GALILEO_DECAY_HALF_LIFE_DAYS=30

# Obsidian
GALILEO_OBSIDIAN_VAULT_PATH=~/Documents/MyVault
```

## Architecture

```
Channels --> SQLite --> Polling loop --> Memory recall (Neo4j)
  --> Container (Claude Agent SDK) --> Credential Proxy
    --> LM Studio (Qwen 27B) OR Anthropic API (Claude)
  --> Response --> Memory store (Neo4j + entity extraction)
```

The credential proxy transparently translates between Anthropic and OpenAI API formats. The container never knows which model it's talking to — local models get the full agent experience.

### Key Files

**NanoClaw core:**
- `src/index.ts` — Orchestrator: state, message loop, agent invocation
- `src/credential-proxy.ts` — API routing + format translation
- `src/container-runner.ts` — Spawns agent containers with mounts
- `src/db.ts` — SQLite operations

**Galileo extensions:**
- `src/galileo/config.ts` — GALILEO_* env var configuration
- `src/galileo/memory-layer.ts` — Public API: recallMemory + storeMemory
- `src/galileo/graphiti-client.ts` — Neo4j client: episode CRUD, hybrid search
- `src/galileo/embeddings.ts` — nomic-embed-text via LM Studio
- `src/galileo/entity-extractor.ts` — Qwen 9B entity/relationship extraction
- `src/galileo/decay.ts` — Temporal decay scoring

For full architecture details, see [docs/SPEC.md](docs/SPEC.md).

## Requirements

- macOS (Mac Mini or Mac Studio recommended)
- Node.js 20+
- [Claude Code](https://claude.ai/download)
- [Apple Container](https://github.com/apple/container) or [Docker](https://docker.com/products/docker-desktop)
- [Neo4j 5+](https://neo4j.com/download/) (for knowledge graph memory)
- [LM Studio](https://lmstudio.ai) (for local model routing)

## Upstream Updates

Galileo tracks upstream NanoClaw. To pull updates:

```bash
git fetch upstream
git merge upstream/main
```

Galileo's core modifications are minimal (~15 lines in `src/index.ts`), so merge conflicts should be rare. Run `/update-nanoclaw` for guided merging.

## License

MIT
