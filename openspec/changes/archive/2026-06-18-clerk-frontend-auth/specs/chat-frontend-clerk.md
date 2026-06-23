# Delta for Chat Frontend — Clerk Auth Migration

## ADDED Requirements

### Requirement: Auth Gating

The system MUST redirect unauthenticated users to `/sign-in` when accessing chat routes. The `<ClerkProvider>` wrapper and `middleware.ts` MUST enforce this. The chat UI MUST NOT render without an active Clerk session.

#### Scenario: Redirect on unauthenticated access

- GIVEN a user without a valid Clerk session
- WHEN they navigate to `/chat`
- THEN they MUST be redirected to `/sign-in`

#### Scenario: Authenticated access

- GIVEN a user with a valid Clerk session
- WHEN they navigate to `/chat`
- THEN the chat UI MUST render normally
- AND API requests MUST include the Clerk JWT

## MODIFIED Requirements

### Requirement: API Client

The system MUST provide an HTTP client that connects to `POST /v1/chat/message` on the backend, accepting `NEXT_PUBLIC_API_URL` and dynamically obtaining a Clerk JWT via `useAuth().getToken()`. The client MUST set `Authorization: Bearer <token>` on every request. The client MUST NOT use `NEXT_PUBLIC_API_KEY`.
(Previously: used static NEXT_PUBLIC_API_KEY as Bearer token)

#### Scenario: Happy path — send and receive reply

- GIVEN `NEXT_PUBLIC_API_URL=http://localhost:8000` and an authenticated Clerk session
- WHEN the client POSTs to `/v1/chat/message` with `{"message": "consulta CUIT 20324837796"}`
- THEN it targets `http://localhost:8000/v1/chat/message` with `Authorization: Bearer <clerk_jwt>`
- AND returns `{conversation_id, reply, actions_taken, data}`

#### Scenario: Network timeout

- GIVEN the API server is unreachable
- WHEN a request times out (20s default)
- THEN the client rejects with a `TIMEOUT` error

#### Scenario: API error response

- GIVEN the API returns a 4xx or 5xx
- WHEN the client receives the response
- THEN it surfaces the error detail to the caller

#### Scenario: No session token

- GIVEN no active Clerk session
- WHEN the client attempts a request
- THEN it MUST fail with `AUTH_REQUIRED` error

### Requirement: Conversation Persistence

The system MUST persist conversations via the backend API (`POST /v1/chat/conversations/save`), auto-saving per message exchange. On load, conversations MUST be fetched from `GET /v1/chat/conversations`. localStorage conversations SHOULD be migrated to the backend on first login. An empty list MUST show an empty state.
(Previously: persisted exclusively to localStorage)

#### Scenario: Auto-save on message exchange

- GIVEN an active conversation with existing messages
- WHEN a user sends a message AND the assistant reply is received
- THEN `POST /v1/chat/conversations/save` is called with the updated messages

#### Scenario: Load on init

- GIVEN stored conversations exist on the backend
- WHEN `useChat` initializes
- THEN the list is fetched from `GET /v1/chat/conversations`

#### Scenario: Empty state

- GIVEN no conversations for the tenant
- WHEN `useChat` loads the list
- THEN the UI shows an empty-state prompt

### Requirement: useChat Hook

The system MUST provide a `useChat` hook that encapsulates message send, conversation history, loading/error state, and backend API persistence. On mount, it MUST fetch the conversation list from `GET /v1/chat/conversations`. The hook MUST support creating, switching, and deleting conversations via the backend API.
(Previously: used localStorage for persistence)

#### Scenario: Send message via hook

- GIVEN a `useChat` instance with `conversationId`
- WHEN `sendMessage("consulta CUIT 20324837796")` is called
- THEN loading state MUST be `true`
- AND on success, loading MUST be `false` and messages MUST include the reply

#### Scenario: Network error in hook

- GIVEN a `useChat` instance
- WHEN `sendMessage` is called and the network fails
- THEN `error` state MUST be set with the error detail
- AND `loading` MUST be `false`
- AND the user message MUST remain in history

#### Scenario: Load conversations on mount

- GIVEN the user is authenticated
- WHEN `useChat` mounts
- THEN it MUST call `GET /v1/chat/conversations`
- AND `selectedConversation` MUST be the most recent one

### Requirement: Environment Variables

The frontend MUST read `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from environment. `NEXT_PUBLIC_API_URL` MUST default to `http://localhost:8000`. `NEXT_PUBLIC_API_KEY` MAY be removed.
(Previously: required NEXT_PUBLIC_API_KEY at build time)

#### Scenario: Default values

- GIVEN no `.env.local` file
- WHEN the frontend starts
- THEN `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000`

#### Scenario: Clerk key present

- GIVEN `.env.local` has `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- WHEN ClerkProvider initializes
- THEN the key MUST be available to Clerk
