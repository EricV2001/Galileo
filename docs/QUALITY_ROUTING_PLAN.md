# Quality-Based Routing Plan

Future enhancement for Galileo's local model routing. Currently, routing is a simple toggle (`LOCAL_FIRST` / `LOCAL_ONLY` / `CLAUDE_ONLY`). This document outlines the planned quality-threshold approach.

## Current State

The credential proxy routes all `/v1/messages` requests based on `GALILEO_ROUTING_MODE`:
- `LOCAL_FIRST` — Try LM Studio, fall back to Claude on failure
- `LOCAL_ONLY` — LM Studio only, 502 on failure
- `CLAUDE_ONLY` — Always Claude (default)

This is binary: all requests go to one model or the other. There's no per-request intelligence.

## Planned: Quality Threshold Routing

Route based on estimated task complexity:

```
Request arrives
  -> Classify complexity (SIMPLE / MEDIUM / COMPLEX)
  -> SIMPLE: always local (Qwen 27B)
  -> MEDIUM: local with quality check, escalate if needed
  -> COMPLEX: always Claude
```

### Complexity Signals

| Signal | SIMPLE | COMPLEX |
|--------|--------|---------|
| Tool calls requested | 0-1 | 3+ |
| System prompt length | Short | Long with examples |
| Conversation turns | 1-3 | 10+ |
| Message content | Short, direct | Multi-step instructions |
| Previous escalations | None in session | Recent escalation |

### Quality Check (for MEDIUM)

After local model responds, optionally verify:
1. Did it follow tool-calling format correctly?
2. Did it produce valid JSON when asked?
3. Did it stay on topic?

If quality check fails, re-route to Claude with the same request.

### Self-Escalation

The local model can request escalation by including a marker in its response:
```
ESCALATE_TO_CLAUDE: <reason>
```

The proxy detects this, strips the marker, and re-routes to Claude. This mirrors the escalation pattern from Galileo1.

## Configuration (future .env keys)

```env
GALILEO_ROUTING_MODE=QUALITY_THRESHOLD
GALILEO_QUALITY_CLASSIFIER=simple     # simple | llm
GALILEO_ESCALATION_ENABLED=true
```

## Implementation Notes

- The classifier runs on the host process (not in the container)
- Start with a simple heuristic classifier (tool count + message length)
- LLM-based classifier is a future option (use Qwen 9B for classification)
- Quality checks add latency — make them optional and async where possible
- Track routing decisions in logs for tuning

## Dependencies

- Phase 2 (credential proxy translation) must be complete first
- Needs telemetry/logging to tune thresholds
- Consider A/B testing: route to both, compare quality
