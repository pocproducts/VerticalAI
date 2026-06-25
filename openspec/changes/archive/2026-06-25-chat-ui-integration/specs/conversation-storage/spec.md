# Delta for conversation-storage

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: List Conversations

The system MUST provide `GET /v1/chat/conversations` that returns conversations for the authenticated tenant. Each entry MUST include `conversation_id`, `title` (derived from first user message content), `message_count`, and `updated_at`. Results MUST be ordered by `updated_at` descending.

(Previously: `title` was described as "first message preview" without specifying content source.)

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

### Requirement: Redis Storage Format

Conversations MUST be stored as Redis hashes with key prefix `tenant:{tenant_id}:conv:{conversation_id}`. Each hash MUST contain `messages` (JSON array), `title` (str, derived from first user message), `created_at`, and `updated_at` (ISO timestamps).

(Previously: `title` was not stored in the hash.)

#### Scenario: Correct key format

- GIVEN tenant `t01` and conversation `conv_01`
- WHEN the conversation is saved
- THEN the Redis key MUST be `tenant:t01:conv:conv_01`
- AND it MUST be a hash with `messages`, `title`, `created_at`, `updated_at`
