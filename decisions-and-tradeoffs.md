# Decisions & tradeoffs

This doc exists because "handles rate limiting, error handling, and structured output" isn't a feature — it's four separate decisions per agent. Writing them down is itself the point of this project.

## Platform: n8n over Zapier / Make

| | Zapier | Make | n8n (chosen) |
|---|---|---|---|
| Free tier | ~100 tasks/mo, single-step limits | ~1,000 ops/mo | Unlimited, self-hosted (Community Edition) |
| Portable / GitHub-able | No — lives in vendor cloud | No — lives in vendor cloud | Yes — exports as JSON |
| Loops / branching | Needs workarounds (Paths, Sub-Zaps) | Native | Native |
| Data ownership | Vendor-hosted | Vendor-hosted | Self-hosted, full control |

For a project whose whole point is being inspected by a recruiter on GitHub, "exports as a file" beat every other consideration. n8n is fair-code (Sustainable Use License), not fully open-source — free for personal/non-commercial use and redistribution, which fits this project exactly.

## Rate limiting

Two different rate limits exist here, handled two different ways:
- **Anthropic API limits** — handled by each `HTTP Request` node's native `retryOnFail: true, maxTries: 3, waitBetweenTries: 2000`. This is n8n's built-in retry, not custom code.
- **n8n's own throughput** — irrelevant at self-hosted, portfolio scale (a handful of runs), but would matter if this were deployed at volume — queue mode would be the next step.

## Error handling

Deliberately two-tiered:
1. **Transient failures** (network blip, momentary 429) → caught by the node-level retry above, invisible to the rest of the workflow.
2. **Structural failures** (model returns malformed JSON, or — for Data Intelligence — a write/DDL statement instead of read-only SQL) → caught explicitly by a `Code` node that parses and validates the schema, then an `IF` node that routes failures to a `Log_Validation_Failure` node instead of silently continuing.

Nothing fails silently. Every failure path ends in a logged, inspectable state.

## Structured output

Each agent's final `Code` node parses the model's JSON response and checks for the fields the next step depends on (e.g. `stories`, `findings`, `sql`, `scenarios`). If the field is missing or the JSON doesn't parse, the workflow treats it as invalid — it does not guess or partially proceed.

## Why the AI never decides

Decision Intelligence's own prompt explicitly instructs the model not to pick a final answer — only to score and rank scenarios. Every agent's last automated step is a notification to a human reviewer via Discord webhook, and an n8n `Wait` node (resume-on-webhook) that pauses the workflow until a person approves or rejects. This is the one design choice I'd defend hardest in an interview: the agents recommend, they don't act.

## What's simplified for a portfolio scope (and why)

- **Local file logging** instead of a database — sufficient to prove the pattern; a real deployment would use Postgres/Airtable so a reviewer doesn't need file-system access.
- **One retry tier, not per-step validation** — each of the 5 (or 3) pipeline steps relies on the node-level retry for transient errors; only the *final* output gets full schema validation. A production version would validate after every step, at the cost of more nodes and more LLM calls.
- **Discord for the approval gate** — chosen because it's free and requires no OAuth setup, not because it's the "correct" enterprise tool (that would likely be Slack or an internal review queue).
