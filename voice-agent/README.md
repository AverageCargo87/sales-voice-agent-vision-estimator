# voice-agent: Eric, provisioned as code

A trilingual (RU / EN / EL) inbound sales agent on ElevenLabs Conversational AI. Nothing is clicked together in a dashboard: idempotent TypeScript scripts create and update every platform object, and record what they created in `state.json` so each step can be re-run safely.

```
npm run setup          00-preflight -> 01-upload-kb -> 02-create-tools -> 03-create-agent
npm run setup:dry      the same chain against a local fake API (no key, nothing leaves the machine)
npm run attach-phone   04: SIP trunk number -> agent (a separate, deliberate step)
npm run teardown       99: phone -> agent -> tools -> knowledge base, then clears state
npm run check:agent    gotcha lint + broken-copy tests + tool/n8n/CRM contract (offline)
npm run state          what exists right now
```

| Step | What it does | Idempotency |
|---|---|---|
| `00-preflight` | files, tool lint, env, API ping, voice check, n8n ping, state summary | read-only |
| `01-upload-kb` | uploads the knowledge base, polls indexing (4 s, 180 s timeout) | reuses an indexed document, replaces a failed one |
| `02-create-tools` | 6 webhook tools as workspace objects | unchanged definitions skipped (hash of what was sent), changed ones PATCHed |
| `03-create-agent` | prompt + LLM + KB + tool ids + voice + language presets | creates once, then safe PATCH with the full baseline |
| `04-attach-phone` | SIP trunk number, assigned to the agent | refuses to attach twice |
| `99-teardown` | deletes in reverse order | 404 = already gone; state kept on errors so it can be retried |

## The dry run

`npm run setup:dry` answers every request from `scripts/utils/dryrun.ts`, a small stand-in for the API slice the scripts use. Each payload is printed and saved under `.dry-run/requests/` (credentials redacted), so the exact JSON can be reviewed before a credit is spent. Created objects persist between runs, so a second dry run exercises the idempotency paths, and PATCH on an agent replaces top-level objects like the real API.

```
=== 03-create-agent (dry run) ===
[03 agent] Languages: en + presets ru,el | TTS eleven_multilingual_v2
[03 agent] ✓ Baseline passes the gotcha lint
  [dry-run] POST   /v1/convai/agents/create  (26.3 kB)  agent "Eric - Acme Steel Homes" lang=en+ru,el tts=eleven_multilingual_v2 llm=claude-haiku-4-5 tools=6 prompt=22238 chars
```

## Files

| Path | Role |
|---|---|
| `config/agent.json` | static baseline: RAG settings, TTS/ASR, turn-taking, evaluation criteria, data collection, privacy |
| `config/tools.json` | the 6 webhook tools with full JSON schemas (`{{N8N_WEBHOOK_BASE}}` and `{{OWNER_NAME}}` are filled at deploy time) |
| `prompts/system_prompt.md` | Eric's prompt: identity, KPI, the 7-stage funnel, 7 segments, playbooks, objections, tool rules, guardrails |
| `knowledge_base.example.md` | the RAG source, sanitised: same 15 sections, illustrative prices, partners by role, no contacts |
| `scripts/utils/lint.ts` | the 8 lintable API pitfalls (#1, 2, 4, 6, 8, 9, 12, 13) as checks; the other 5 are handled in the client ([docs/ELEVENLABS_GOTCHAS.md](../docs/ELEVENLABS_GOTCHAS.md)) |
| `scripts/utils/baseline.ts` | builds the full baseline: TTS auto-pick, language presets, first-message hashes |

The production prompt and knowledge base were written in Russian; the published versions are English translations with the company renamed, partner names generalised and every price replaced by an illustrative one. The private knowledge base, if present at `voice-agent/knowledge_base.md` (gitignored), takes precedence automatically.
