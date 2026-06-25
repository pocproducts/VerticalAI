# Proposal: Chat UI Integration

## Intent

The chat frontend cannot maintain conversation history because: (1) `history` field is ignored — each message is an island, (2) no auto-persist, (3) SSE streams don't emit `conversation_id` until the end, (4) no tenant scoping. This wires the existing conversation layer into the chat endpoint.

## Scope

### In Scope
1. Wire `history` field into pipeline as multi-turn context
2. Auto-persist user + assistant messages after each turn (sync and stream)
3. Emit `conversation_id` as first SSE event (`event: conversation_start`)
4. Scope conversations by `tenant_id` from auth middleware

### Out of Scope
- Frontend changes, LLM conversational memory, wizard changes, localStorage migration

## Capabilities

### New Capabilities
None — all changes fit within existing capabilities.

### Modified Capabilities
- `chat-backend`: `history` MUST be passed to pipeline; SSE MUST emit `conversation_id` at start; chat endpoint MUST auto-persist messages; conversations MUST use `tenant_id`
- `conversation-storage`: MUST support auto-persist triggered by chat endpoint; expose `append_messages(tenant_id, conv_id, messages)` for atomic append

## Approach

1. Use `request.state.tenant.tenant_id` (already injected by middleware)
2. Non-streaming: append user + assistant via new `append_messages` on `ConversationStore`; use incoming `conversation_id` or generate new
3. Streaming: emit `conversation_start` event first; on `complete`, append both messages
4. Deserialize `history` from `ChatRequest` and prepend to pipeline message list
5. Reuse existing Redis key schema `tenant:{tenant_id}:conv:{conversation_id}`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/api/routes/chat.py` | Modified | Wire history, auto-persist, tenant scoping, SSE start event |
| `fiscal_agent/api/store.py` | Modified | Add `ConversationStore.append_messages()` |
| `fiscal_agent/api/routes/conversations.py` | Modified | Ensure tenant scoping on existing CRUD |
| `openspec/specs/chat-backend/spec.md` | Delta | History, auto-persist, SSE start event reqs |
| `openspec/specs/conversation-storage/spec.md` | Delta | Auto-persist + append_messages req |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| History grows latency | Low | Truncate to last 10 turns |
| Duplicate on stream disconnect | Med | Atomic append; idempotent via conv_id |
| Breaking streaming clients | Med | New event type is additive — unknown events ignored |

## Rollback Plan

Revert `chat.py`, `store.py`, `conversations.py`. `conversation_start` event is ignored by unaware clients. No data loss — existing conversations remain accessible via CRUD.

## Dependencies

- `request.state.tenant` from TenantContext middleware
- `ConversationStore` with existing CRUD ops
- Pipeline already wired in chat endpoint

## Success Criteria

- [ ] `POST /v1/chat/message` with `conversation_id` persists both messages
- [ ] `POST /v1/chat/message/stream` emits `conversation_id` as first event
- [ ] `history` affects intent routing (proven via spec scenario)
- [ ] All conversation keys include `tenant:{tenant_id}` prefix
- [ ] Existing CRUD endpoints still work with tenant scoping
