# ElevenLabs Conversational AI: 13 pitfalls, and where this repo guards against each

Every item below cost a debugging session while the voice agent was being provisioned. Several of them fail **silently**: the API accepts the request and drops a field. So the fix is not a note in a wiki but a check in code: `voice-agent/scripts/utils/lint.ts` refuses to send a payload that would trigger any of the 8 lintable ones (#1, 2, 4, 6, 8, 9, 12, 13); the rest are handled in the client code named in the table, and `npm run check:agent` proves each rule still fires by feeding it a deliberately broken copy.

| # | Pitfall | Enforced by |
|---|---|---|
| 1 | PATCH replaces top-level objects | `updateAgent()` always sends a full baseline; lint rejects partial baselines |
| 2 | Inline tools are deprecated | tools are workspace objects referenced by `tool_ids`; lint rejects inline `tools` |
| 3 | Knowledge base indexing is asynchronous | `pollKnowledgeBaseUntilReady()` |
| 4 | Webhook tools time out after 30 s | lint caps `response_timeout_secs`; contract check verifies every n8n workflow answers first |
| 5 | A SIP trunk is its own provider type | `04-attach-phone.ts` |
| 6 | Knowledge base entries need a usage mode | baseline builder + lint |
| 7 | Text documents have no status field | the poller treats "no status" as ready |
| 8 | Every schema node needs a description | lint walks every property and every `items` |
| 9 | `additional_languages` is silently ignored | baseline builder uses `language_presets`; lint rejects the old field |
| 10 | Large requests drop mid-flight | idempotent steps: re-run and they resume |
| 11 | The WAF rejects large PATCH bodies from Node fetch | curl transport |
| 12 | Translated first messages need the source hash | baseline builder computes it; lint verifies it |
| 13 | English-primary agents refuse turbo/flash v2_5, and per-language TTS overrides vanish | TTS auto-pick + lint |

---

### 1. PATCH on an agent replaces, it does not merge

`PATCH /v1/convai/agents/{id}` replaces each top-level object it receives (`conversation_config`, `platform_settings`, ...) wholesale. Send `{ "name": "X" }` expecting a rename and you get an agent with no prompt, no tools, no voice, no languages and no knowledge base.

**Rule:** never send a delta. Read the current agent (or the last baseline you sent, kept in `state.json`), deep-merge the change into it, and send the whole thing. `ElevenLabsClient.updateAgent()` does exactly that, and `lintAgentBaseline()` refuses any baseline that is missing the name, language, first message, prompt, LLM, voice, TTS model or platform settings. The dry-run fake API implements the same replace semantics, so the mistake reproduces offline.

### 2. Tools live in the workspace, agents reference them

Defining tools inline on the agent is deprecated. Create each one with `POST /v1/convai/tools`, keep the returned id, and put the ids in `conversation_config.agent.prompt.tool_ids`. Deleting a tool is a separate `DELETE /v1/convai/tools/{id}`, which is why teardown walks the tool ids from state.

### 3. A knowledge base document is not ready when it is created

After uploading a file or URL document the API returns an id, but retrieval does not work until indexing finishes. Poll `GET /v1/convai/knowledge-base/{id}` every few seconds until the status is `succeeded` (typically 30 to 120 s; the scripts give up at 180 s). Attaching the document earlier is allowed, but the agent cannot answer from it yet.

### 4. A webhook tool has 30 seconds, total

The agent waits at most 30 s for a webhook. If the n8n workflow does its work first and answers last, any slow step (a Sheets append on a cold instance) turns into the agent saying it has "technical problems". Every workflow must **answer first** with a `Respond to Webhook` node and do the work after it. `check-config.ts` verifies this for each built workflow (`responseMode: responseNode` and the response node directly after the webhook), and the tool lint keeps `response_timeout_secs` at or below 30.

### 5. A SIP trunk is `provider: "sip_trunk"`

Attaching a number from a SIP provider (Telnyx here) uses `POST /v1/convai/phone-numbers/create` with `provider: "sip_trunk"` and inbound/outbound trunk addresses plus credentials. It is not the Twilio flow with different values.

### 6. Knowledge base references are objects with a usage mode

Each entry in `prompt.knowledge_base` is `{ id, name, type, usage_mode }`. `usage_mode: "auto"` means RAG: the agent retrieves chunks when it needs them. `"prompt"` pastes the whole document into the system prompt on every turn, which only makes sense for small documents. The production knowledge base is about 45 kB, so it runs in `auto`.

### 7. Text documents index synchronously and report no status

Unlike file and URL documents, a document created from text has no `status` or `rag_status` field in its GET response at all. A poller that waits for `succeeded` waits forever. The poller here treats a missing status as "ready", and the dry-run fake API reproduces the missing field.

### 8. Every schema node needs a description

Webhook tool schemas are validated strictly: every property, and every `items` of every array, must carry one of `description`, `dynamic_variable`, `is_system_provided` or `constant_value`. Otherwise the API answers 422 with a long `loc` path. The easy one to forget is `items` inside an array. The lint walks the whole schema tree, also checking that every `required` field exists and every enum is non-empty.

### 9. `additional_languages` is silently dropped

`conversation_config.agent.additional_languages` is outdated: the API accepts it and throws it away, no error. Extra languages go into `conversation_config.language_presets`, an object keyed by language with per-language overrides. The baseline builder generates the presets from `AGENT_LANGUAGES`; the lint rejects the old field and a preset that duplicates the primary language.

### 10. Large requests sometimes drop mid-flight

Big requests (an agent create with a 40 kB+ prompt is typical) occasionally fail with a socket error such as "other side closed". A plain retry works. Because every step is idempotent and records what it created in `state.json`, the answer is simply to re-run: finished steps are skipped or updated in place.

### 11. The WAF in front of the API rejects large PATCH bodies from Node fetch

PATCH requests with bodies above roughly 30 kB, sent from Node's built-in fetch (undici), were consistently answered with a 403 or a redirect by the WAF in front of the API. The identical request from curl went through; changing the User-Agent or setting Content-Length by hand did not help. The working hypothesis is the TLS fingerprint. The client therefore uses the system `curl` as its transport (built into Windows 10+, present on macOS and Linux), passing headers and body through temp files so the API key never appears in a process command line. The estimator's Anthropic client uses the same transport for the same reason.

### 12. A translated first message needs the hash of the original

In `language_presets.{lang}.first_message_translation` both `text` and `source_hash` are required, where `source_hash` is the SHA-256 of the primary-language first message. It lets the platform detect that the original changed and the translation is stale; a wrong hash is rejected. The baseline builder computes it; the lint recomputes it and compares.

### 13. English-primary agents refuse the multilingual turbo/flash models, and per-language TTS overrides vanish

With `agent.language = "en"` the API rejects `eleven_turbo_v2_5` and `eleven_flash_v2_5` ("English Agents must use turbo or flash v2"). The accepted models are the English-only `eleven_turbo_v2` / `eleven_flash_v2` and the multilingual `eleven_multilingual_v2`. The obvious workaround, a TTS model override inside a language preset, does not work either: the PATCH succeeds, and a GET shows the override gone. When the conversation switches language the agent keeps the BASE model, so the base model must be multilingual.

**Result:** English primary with Russian and Greek -> `eleven_multilingual_v2` (slower than flash, but the only option). Any other primary -> `eleven_turbo_v2_5`. `pickTtsModel()` chooses automatically (overridable with `TTS_MODEL`); the lint rejects both the forbidden combination and any per-language TTS override.

---

```
npm run check:agent
-- EACH RULE REJECTS A BROKEN COPY --
✓ #8  property without a description -> rejected
✓ #8  array items without a description -> rejected
✓ #8  required field missing from properties -> rejected
✓ #4  webhook timeout above the 30 s platform cap -> rejected
✓ #2  one of the 6 tools missing -> rejected
✓ #1  partial baseline (no platform_settings) -> rejected
✓ #1  partial baseline (no voice) -> rejected
✓ #2  inline tools on the agent -> rejected
✓ #6  unknown KB usage_mode -> rejected
✓ #9  additional_languages (silently dropped) -> rejected
✓ #12 stale first_message source_hash -> rejected
✓ #13 English primary + turbo_v2_5 -> rejected
✓ #13 per-language TTS override (silently dropped) -> rejected
✓ #1  updateAgent merges a delta into the full baseline, nothing is wiped
```
