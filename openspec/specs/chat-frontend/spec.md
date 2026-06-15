# chat-frontend Specification

## Purpose

Chat UI mapping natural-language queries to the REST API via a single `POST /v1/chat/message` endpoint. No LLM — intent routing moves to the backend. Standalone Next.js with docker-compose.

## Requirements

### Requirement: API Client

The system MUST provide an HTTP client that connects to `POST /v1/chat/message` on the backend, accepting `NEXT_PUBLIC_API_URL` and `Authorization: Bearer <key>` on every request. The client SHOULD NOT route to individual REST endpoints — intent routing moves to the backend.

#### Scenario: Happy path — send and receive reply

- GIVEN `NEXT_PUBLIC_API_URL=http://localhost:8000` and a valid API key
- WHEN the client POSTs to `/v1/chat/message` with `{"message": "consulta CUIT 20324837796"}`
- THEN it targets `http://localhost:8000/v1/chat/message` with the `Authorization` header
- AND returns `{conversation_id, reply, actions_taken, data}`

#### Scenario: Network timeout

- GIVEN the API server is unreachable
- WHEN a request times out (20s default)
- THEN the client rejects with a `TIMEOUT` error

#### Scenario: API error response

- GIVEN the API returns a 4xx or 5xx
- WHEN the client receives the response
- THEN it surfaces the error detail to the caller

### Requirement: Conversation Persistence

The system MUST persist conversations to `localStorage`, auto-saving per message exchange via the `useChat` hook. On reload, conversations MUST restore including full message history. New conversations (no prior storage) SHOULD show an empty state.

#### Scenario: Auto-save on message exchange

- GIVEN an active conversation with existing messages
- WHEN a user sends a message AND the assistant reply is received
- THEN `localStorage` contains both the user message and the assistant reply

#### Scenario: Restore on reload

- GIVEN conversations exist in `localStorage`
- WHEN the page loads and `useChat` initializes
- THEN the conversation list is restored including full message history

#### Scenario: Empty state

- GIVEN no conversations in `localStorage`
- WHEN the page loads
- THEN the UI shows an empty-state prompt

### Requirement: useChat Hook

The system MUST provide a `useChat` hook that encapsulates message send (via API client), conversation history, loading state, error state, and LocalStorage persistence.

#### Scenario: Send message via hook

- GIVEN a `useChat` instance with `conversationId`
- WHEN `sendMessage("consulta CUIT 20324837796")` is called
- THEN loading state MUST be `true`
- AND the hook MUST POST to `/v1/chat/message` with the message and conversation history
- AND on success, loading MUST be `false` and messages MUST include the reply

#### Scenario: Network error in hook

- GIVEN a `useChat` instance
- WHEN `sendMessage` is called and the network fails
- THEN `error` state MUST be set with the error detail
- AND `loading` MUST be `false`
- AND the user message MUST remain in history

#### Scenario: Restore from LocalStorage

- GIVEN stored conversations in `localStorage`
- WHEN `useChat` initializes
- THEN `conversations` MUST be populated from storage
- AND `selectedConversation` MUST be the most recent one

### Requirement: Environment Variables

The frontend MUST read `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_API_KEY` from environment. `NEXT_PUBLIC_API_URL` MUST default to `http://localhost:8000`. Both MUST be present at build time.

#### Scenario: Default values

- GIVEN no `.env.local` file
- WHEN the frontend starts
- THEN `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000`

### Requirement: Next.js API Rewrites

`next.config.mjs` MUST rewrite `/api/*` requests to the backend at `NEXT_PUBLIC_API_URL/*`. This MUST proxy requests server-side to avoid CORS and hide the API key from the browser.

#### Scenario: Rewrite active

- GIVEN `next.config.mjs` with rewrites configured
- WHEN the browser requests `/api/v1/chat/message`
- THEN Next.js proxies to `http://localhost:8000/v1/chat/message`

### Requirement: Error Display

The system MUST render API errors as in-chat messages from `UnifiedResponse.error`.

#### Scenario: Auth error

- GIVEN the API returns 401 with `error.code: "UNAUTHORIZED"`
- WHEN the client receives the error
- THEN the chat shows `"Error de autenticación: verificar API key"`

#### Scenario: Server error

- GIVEN the API returns 500
- WHEN the client receives the error
- THEN the chat shows the status code and error detail

#### Scenario: Timeout

- GIVEN the API does not respond within 15s
- WHEN the timeout fires
- THEN the chat shows `"El servidor no respondió a tiempo"`

### Requirement: Loading State

The system MUST display a loading indicator while an API request is in flight.

#### Scenario: Request in flight

- GIVEN the user sent a message
- WHEN the API call is pending
- THEN a typing indicator appears in the chat

#### Scenario: Response received

- GIVEN the loading indicator is visible
- WHEN the API responds (success or error)
- THEN the indicator is replaced by the response content

### Requirement: Frontend Docker Service

A Docker Compose service MUST build and serve the Next.js frontend on port `3000`.

#### Scenario: docker compose up

- GIVEN `docker-compose.yml` includes the frontend service
- WHEN running `docker compose up`
- THEN the frontend is available at `http://localhost:3000`
- AND the service has `depends_on: fiscal-agent`

### Requirement: Backend CORS Configuration

The backend MUST allow cross-origin requests from the frontend origin.

#### Scenario: Frontend origin allowed

- GIVEN CORS allows `http://localhost:3000`
- WHEN the frontend requests from that origin
- THEN the response includes `Access-Control-Allow-Origin: http://localhost:3000`
