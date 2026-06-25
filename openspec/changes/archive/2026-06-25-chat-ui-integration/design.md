# Design: Chat UI Integration

## Technical Approach

Four minimal changes to `chat.py` + one new method on `RedisStore`. No new files, no new dependencies, no schema migration. The existing `ConversationStore` already supports tenant-scoped CRUD — we add `append_messages` for atomic append and wire it into the chat endpoints.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| History injection: prepend to message string vs. full message list | Prepend string keeps `detect()` signature unchanged; message list requires refactoring | Prepend: concatenate `history` entries with current `message` before calling `detect()`. The CUIT + intent keywords in prior turns become available to regex routing. |
| `append_messages()`: Redis HSET with full list vs. `JSON.ARRAPPEND` | HSET is already used by `save_conversation` — consistent; `JSON.ARRAPPEND` adds a RedisJSON dependency | HSET with full list serialization: fetch existing `messages`, append new, write back. Atomic within one HSET call. `ponytail: HSET rewrite; upgrade to JSON.ARRAPPEND if messages exceed 100 entries per conv.` |
| SSE `conversation_start`: always first vs. combined with early return | First event means even early-return SSE (no-CUIT, unknown intent) must emit it first before `complete` | Always first. Refactor `_iter_sse_early()` to yield `conversation_start` then `complete`. |

## Data Flow

```
                         ChatRequest
                             │
               ┌─────────────┼─────────────┐
               │ history      │ message      │ conversation_id
               ▼              ▼              ▼
      Prepend history ──► detect() ──► intent + cuit
               │                            │
               │                   ┌────────┴────────┐
               │                   ▼                 ▼
               │           sync handler      SSE generator
               │                   │                 │
               │                ChatResponse    conversation_start (event)
               │                   │                 │
               └──── append_messages() ◄─── progress/complete
                                    │
                                    ▼
                           Redis HSET
                     tenant:{tid}:conv:{cid}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/api/store.py` | Modify | Add `RedisStore.append_messages()` — atomic append of messages to existing/new conversation with TTL refresh and title auto-generation |
| `fiscal_agent/api/routes/chat.py` | Modify | Wire history → detect(), auto-persist after turn, emit `conversation_start` first in SSE, extract `tenant_id` from `request.state` |
| `fiscal_agent/api/routes/conversations.py` | None | Already tenant-scoped via `_tenant_id()` helper — no changes needed |

## Interfaces / Contracts

### New store method

```python
async def append_messages(
    self,
    tenant_id: str,
    conversation_id: str,
    messages: list[dict],  # [{"role": "user"|"assistant", "content": str}, ...]
) -> str:  # returns conversation_id
    """Atomically append messages. Creates conversation if new.
    Sets title from first user message content on creation."""
```

### History prepend logic

```python
# chat.py — before detect()
context = message
if request.history:
    history_text = "\n".join(
        m["content"] for m in request.history
        if m.get("content")
    )
    context = f"{history_text}\n{message}"
intent, cuit, params = detect(context)
```

### SSE event order

```
event: conversation_start\ndata: {"conversation_id": "..."}\n\n
event: progress\ndata: {"message": "..."}\n\n  (if REPORTE_COMPLETO)
event: complete\ndata: {"reply": "...", ...}\n\n
```

For early returns (no CUIT, unknown intent): `conversation_start` then a single `complete`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `append_messages()` | Test append to existing, create new, title generation, TTL refresh |
| Unit | History prepend | Test that `detect()` finds CUIT from history when current message lacks it |
| Integration | Chat flow | Full round-trip: POST with history → response includes `conversation_id` → GET conversation shows persisted messages |
| Integration | SSE flow | Stream response: first event type is `conversation_start`, persisted messages appear |

## Migration / Rollout

No migration required. Existing conversations in Redis remain valid (key schema unchanged). New `conversation_start` SSE event is ignored by unaware clients per SSE spec (unknown event types are skipped).

## Open Questions

None.
