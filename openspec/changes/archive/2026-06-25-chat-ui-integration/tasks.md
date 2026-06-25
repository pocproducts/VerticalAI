# Tasks: Chat UI Integration

## Review Workload Forecast

**Under 400 lines.** 2 files modified, 0 new files. Estimated additions: ~60 lines total. Tests add ~150 lines.

---

## Phase 1: Store Layer

### [x] Task 1.1 — Add `append_messages()` to `RedisStore`

**File:** `fiscal_agent/api/store.py`

Add method to `RedisStore`:

```python
async def append_messages(
    self,
    tenant_id: str,
    conversation_id: str,
    messages: list[dict],
) -> str:
```

**Behavior:**
- Fetch existing conversation data via `_KEY_CONV` hash
- If conversation exists: deserialize `messages` list, append new messages, write back with `updated_at`, refresh TTL
- If conversation does not exist: create new hash with `id`, `title` (first user message content truncated), `messages`, `created_at`, `updated_at`; add to `_KEY_CONV_ALL` set; set TTL
- Atomic within one HSET call (serialize full messages list each time) — `ponytail: HSET rewrite, upgrade to JSON.ARRAPPEND if messages exceed 100`
- Return `conversation_id`

**Spec ref:** `conversation-storage/spec.md` — Requirement "ConversationStore.append_messages()"

**Scenarios to satisfy:**
- Append to existing conversation (messages count goes from 2→4, updated_at refreshes, TTL refreshes)
- Create conversation on first append (new key, created_at set, title derives from first user message)
- Title auto-generation from first user message content

**Acceptance:**
- `append_messages("t01", "conv_01", [user_msg, assistant_msg])` on existing conv with 2 messages → 4 total
- `append_messages("t01", "conv_new", [user_msg, assistant_msg])` on nonexistent → new hash with all fields
- Title is preview of first user content (e.g. `"consulta datos del contribuyente..."`)
- `updated_at` is set to current ISO timestamp each call
- TTL is reset to 90 days each call

---

## Phase 2: Chat Endpoint Changes

### [x] Task 2.1 — Wire `history` into intent detection

**File:** `fiscal_agent/api/routes/chat.py`

Before calling `detect(message)`, prepend history entries:

```python
context = message
if request.history:
    history_text = "\n".join(
        m["content"] for m in request.history if m.get("content")
    )
    context = f"{history_text}\n{message}"
intent, cuit, params = detect(context)
```

**Affects both** `chat_message()` (sync) **and** `chat_message_stream()` (SSE).

**Spec ref:** `chat-backend/spec.md` — history MUST be prepended as multi-turn context

**Scenario:** "Consulta CUIT with history" — history `[{"role": "assistant", "content": "La deuda total es $15000"}, {"role": "user", "content": "y el calendario?"}]` → `actions_taken` contains `"consultar_calendario"`

**Acceptance:**
- Both sync and streaming endpoints pass history context to `detect()`
- History entries without `content` are skipped
- Current `message` is always appended last

---

### [x] Task 2.2 — Extract `tenant_id` from request state

**File:** `fiscal_agent/api/routes/chat.py`

Both `chat_message()` and `chat_message_stream()` need `tenant_id` from `request.state`.

```python
# In each endpoint handler:
tenant_id = request.state.tenant.tenant_id
```

If the tenant middleware already injects `request.state.tenant` (confirmed in design), this is a simple attribute access.

**Used by:** Task 2.3 (auto-persist key scoping).

**Spec ref:** `chat-backend/spec.md` — "The server MUST scope this per tenant_id from auth middleware"

**Acceptance:**
- Both sync and streaming endpoints extract `tenant_id` from `request.state`
- Value is used in `append_messages()` calls (Task 2.3)
- Conversation keys use `tenant:{tenant_id}:` prefix

---

### [x] Task 2.3 — Auto-persist messages after each turn

**File:** `fiscal_agent/api/routes/chat.py`

**Sync endpoint** (`chat_message`): After the handler returns and before the `ChatResponse`, call:

```python
store = request.app.state.store  # or get_store() — verify availability
await store.append_messages(tenant_id, conversation_id, [
    {"role": "user", "content": request.message},
    {"role": "assistant", "content": reply},
])
```

**SSE endpoint** (`chat_message_stream`): When emitting `complete` event, call `append_messages()` before yielding the event. For early-return cases (no-CUIT, unknown intent), append only the user message and the early reply.

**Spec ref:** `chat-backend/spec.md` — Auto-persist sections for both sync and stream

**Scenarios:**
- "Messages auto-persisted after turn" — `append_messages()` called with correct args
- "Auto-persist on stream complete" — called before `complete` event

**Acceptance:**
- Sync endpoint persists user + assistant messages after each successful turn
- SSE endpoint persists before `complete` event
- SSE early returns (no CUIT, unknown intent, unsupported intent) also persist both messages
- Key format: `tenant:{tenant_id}:conv:{conversation_id}`

---

### [x] Task 2.4 — Emit `conversation_start` SSE event at stream start

**File:** `fiscal_agent/api/routes/chat.py`

Modify `chat_message_stream()` to emit `conversation_start` as the **first** SSE event, before any processing:

```python
# First, yield conversation_start
yield f'event: conversation_start\ndata: {json.dumps({"conversation_id": conversation_id})}\n\n'
```

**Early-return generator** (`_iter_sse_early`): Refactor to yield `conversation_start` before `complete` instead of emitting only `complete`.

```python
def _iter_sse_early(conversation_id: str, reply: str):
    yield f'event: conversation_start\ndata: {json.dumps({"conversation_id": conversation_id})}\n\n'
    yield f'event: complete\ndata: {json.dumps({"reply": reply, "conversation_id": conversation_id})}\n\n'
```

**Spec ref:** `chat-backend/spec.md` — SSE event table: `conversation_start` is first event

**Scenario:** "conversation_start emitted first" — first SSE event is `event: conversation_start` with `conversation_id`

**Acceptance:**
- `conversation_start` is always the first SSE event in every streaming response
- Early returns (no CUIT, unknown intent, unsupported intent) emit `conversation_start` before `complete`
- Full pipeline (REPORTE_COMPLETO) emits `conversation_start`, then `progress`(s), then `complete`
- `conversation_id` in the event data matches the generated or provided ID

---

## Phase 3: Tests

### [x] Task 3.1 — Unit test: `append_messages()`

**File:** `fiscal_agent/tests/test_something.py` (e.g. `test_store_conversations.py` or add to existing test file)

Since `RedisStore` needs a real or fake Redis, use a fake Redis client (`fakeredis` if available, or mock `redis.hgetall`/`hset`).

**Tests:**
1. `test_append_to_existing` — Create conversation with 2 messages, append 2 more, verify 4 total, updated_at changed, TTL set
2. `test_append_creates_new` — Append to nonexistent conversation, verify key created with fields
3. `test_append_title_generation` — Verify title is derived from first user message content
4. `test_append_refreshes_ttl` — Verify expire() called after append

---

### [x] Task 3.2 — Integration test: history affects intent routing

**File:** `fiscal_agent/tests/test_chat_api.py` (extend existing)

Add test(s) using existing `TestClient` + fixtures:

1. `test_history_disambiguates_intent` — POST with history where current message alone is ambiguous (e.g. `"y el calendario?"` with prior assistant context about debt) → verify correct intent is detected
2. `test_history_no_break` — Verify endpoint still works when `history` is null or empty

Since `detect()` is a pure function, this can also be a unit test of the prepend logic + detect.

---

### [x] Task 3.3 — Integration test: auto-persist flow

**File:** `fiscal_agent/tests/test_chat_api.py` (extend existing)

Mock `get_store()` or inject a fake store into `request.app.state`:

1. `test_sync_auto_persists` — POST to sync endpoint → verify `append_messages` was called with correct args
2. `test_sse_auto_persists` — POST to stream endpoint → verify `append_messages` was called before `complete`

Use `unittest.mock.patch` or inject a `MagicMock` store.

---

### [x] Task 3.4 — Integration test: SSE conversation_start event

**File:** `fiscal_agent/tests/test_chat_api.py` (extend existing)

1. `test_sse_conversation_start_first` — POST to stream, iterate SSE events, assert first event is `conversation_start`
2. `test_sse_early_return_has_conversation_start` — POST with no CUIT, verify first event is still `conversation_start`
3. `test_sse_unsupported_intent_has_conversation_start` — POST with non-report intent (e.g. taxpayer query), verify `conversation_start` first

---

### [x] Task 3.5 — Integration test: tenant scoping

**File:** `fiscal_agent/tests/test_chat_api.py` (extend existing)

Mock `request.state.tenant.tenant_id` to return a test value:

1. `test_tenant_id_extracted` — POST to sync endpoint, verify `tenant_id` was extracted from request state
2. `test_tenant_scoped_key` — Verify conversation key includes `tenant:{tid}:conv:{cid}` format

---

## Phase 4: Verify

### [x] Task 4.1 — Run test suite

```bash
python -m pytest fiscal_agent/tests/ -v
```

All existing tests must pass. New tests must pass.

### Task 4.2 — Manual sanity check (optional)

- Start the server
- `POST /v1/chat/message` with `history` → verify response
- `POST /v1/chat/message/stream` → verify first SSE event is `conversation_start`
- `GET /v1/chat/conversations` → verify persisted messages appear
