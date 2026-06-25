# Conversation Storage Specification

## Purpose

Persist chat conversations to Redis instead of browser localStorage, enabling multi-device access. Provide a tenant-scoped CRUD API for conversations.

## Requirements

### Requirement: Save Conversation

The system MUST provide `POST /v1/chat/conversations/save` that persists a conversation with full message history. The body MUST include `messages` and MAY include `conversation_id` (update) or omit it (new). The response MUST return the `conversation_id`.

#### Scenario: New conversation

- GIVEN an authenticated tenant
- WHEN `POST /v1/chat/conversations/save` is called with `{"messages": [...]}`
- THEN a new conversation MUST be created in Redis
- AND the response MUST return the new `conversation_id`

#### Scenario: Update existing

- GIVEN an existing `conv_01`
- WHEN `POST /v1/chat/conversations/save` is called with `{"conversation_id": "conv_01", "messages": [...]}`
- THEN the conversation MUST be updated in place
- AND messages MUST be replaced by the new payload

### Requirement: List Conversations

The system MUST provide `GET /v1/chat/conversations` that returns conversations for the authenticated tenant. Each entry MUST include `conversation_id`, `title` (derived from first user message content), `message_count`, and `updated_at`. Results MUST be ordered by `updated_at` descending.

#### Scenario: List with data

- GIVEN a tenant with 5 conversations
- WHEN `GET /v1/chat/conversations` is called
- THEN the response MUST contain 5 summaries with `conversation_id`, `title`, `message_count`, `updated_at`
- AND `title` MUST be derived from the first user message content of each conversation
- AND results MUST be sorted by `updated_at` descending

#### Scenario: Empty list

- GIVEN a tenant with no conversations
- WHEN `GET /v1/chat/conversations` is called
- THEN the response MUST return `[]`

### Requirement: Get Single Conversation

The system MUST provide `GET /v1/chat/conversations/{id}` that returns a conversation with full message history. If not found or belongs to another tenant, MUST return 404.

#### Scenario: Fetch existing

- GIVEN `conv_01` exists for this tenant
- WHEN `GET /v1/chat/conversations/conv_01` is called
- THEN the response MUST include `conversation_id`, `messages`, `created_at`, `updated_at`

#### Scenario: Not found

- GIVEN a non-existent `conv_99`
- WHEN `GET /v1/chat/conversations/conv_99` is called
- THEN status MUST be 404
- AND `ApiError.code` MUST be `"CONVERSATION_NOT_FOUND"`

### Requirement: Delete Conversation

The system MUST provide `DELETE /v1/chat/conversations/{id}` that removes a conversation from Redis. Subsequent GET for the deleted ID MUST return 404.

#### Scenario: Delete existing

- GIVEN `conv_01` exists for the tenant
- WHEN `DELETE /v1/chat/conversations/conv_01` is called
- THEN the conversation MUST be deleted from Redis
- AND `GET /v1/chat/conversations/conv_01` MUST return 404

#### Scenario: Delete non-existent

- GIVEN a non-existent `conv_99`
- WHEN `DELETE /v1/chat/conversations/conv_99` is called
- THEN status MUST be 404

### Requirement: Redis Storage Format

Conversations MUST be stored as Redis hashes with key prefix `tenant:{tenant_id}:conv:{conversation_id}`. Each hash MUST contain `messages` (JSON array), `title` (str, derived from first user message), `created_at`, and `updated_at` (ISO timestamps).

#### Scenario: Correct key format

- GIVEN tenant `t01` and conversation `conv_01`
- WHEN the conversation is saved
- THEN the Redis key MUST be `tenant:t01:conv:conv_01`
- AND it MUST be a hash with `messages`, `title`, `created_at`, `updated_at`

### Requirement: TTL for Old Conversations

The system SHOULD apply a 90-day TTL to conversations. The TTL SHOULD be refreshed on each update.

#### Scenario: TTL on create

- GIVEN a new conversation is saved
- WHEN the Redis hash is created
- THEN a 90-day TTL SHOULD be set

#### Scenario: TTL refreshed on update

- GIVEN an existing conversation near TTL expiry
- WHEN the conversation is updated
- THEN the TTL SHOULD be reset to 90 days

### Requirement: ConversationStore.append_messages()

The `ConversationStore` MUST provide an `append_messages(tenant_id, conversation_id, messages)` method for atomic append of messages to an existing conversation. This method is the internal contract used by the chat endpoint for auto-persist and is NOT exposed as a REST endpoint.

The method MUST:
- Accept `tenant_id` (str), `conversation_id` (str), and `messages` (list[dict] with `role` and `content` per message)
- Append the given messages to the existing `messages` array in Redis
- Update `updated_at` to the current ISO timestamp
- Refresh the 90-day TTL
- Create the conversation if it does not yet exist, setting `created_at` and auto-generating `title` from the first user message content
- Be atomic — either all messages are appended or none are

#### Scenario: Append to existing conversation

- GIVEN an existing conversation `conv_01` for tenant `t01` with 2 prior messages
- WHEN `append_messages("t01", "conv_01", [user_msg, assistant_msg])` is called
- THEN the Redis hash `tenant:t01:conv:conv_01` MUST contain 4 messages total
- AND `updated_at` MUST reflect the current time
- AND the TTL MUST be refreshed to 90 days

#### Scenario: Create conversation on first append

- GIVEN no prior conversation for `conv_new`
- WHEN `append_messages("t01", "conv_new", [user_msg, assistant_msg])` is called
- THEN a new Redis hash `tenant:t01:conv:conv_new` MUST be created
- AND `created_at` and `updated_at` MUST be set
- AND `title` MUST be derived from the first user message content

#### Scenario: Title auto-generation from first user message

- GIVEN a user message with content `"consulta datos del contribuyente 20-32483779-6"`
- WHEN `append_messages` creates a new conversation
- THEN `title` SHOULD be set to a preview of that content (e.g., `"consulta datos del contribuyente..."`)

### Requirement: localStorage Migration

On first login, the frontend MUST check for existing conversations in `localStorage`. If found, it MUST upload each to `POST /v1/chat/conversations/save`. On success, the localStorage entry SHOULD be removed. Migration failures MUST NOT block the user.

#### Scenario: Upload on login

- GIVEN a user with 3 conversations in localStorage
- WHEN they log in via Clerk
- THEN each conversation MUST be uploaded to the backend
- AND on success, the localStorage key MUST be cleared

#### Scenario: Migration failure is non-blocking

- GIVEN localStorage conversations exist
- WHEN the backend is unreachable during migration
- THEN the user MUST still be able to use the chat
- AND localStorage conversations MUST remain as fallback
