# Clerk Auth Specification

## Purpose

Integrate Clerk authentication into the Chat UI: login via Google/email, route protection, dynamic JWT injection into API calls, multi-tenant support via Clerk Organizations, and Clerk JWT validation on the backend via JWKS.

## Requirements

### Requirement: ClerkProvider Wrapping

The root layout (`app/layout.tsx`) MUST wrap the application tree with `<ClerkProvider>`. The provider MUST receive `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from environment variables.

#### Scenario: Layout wraps with ClerkProvider

- GIVEN a Next.js app with `@clerk/nextjs` installed
- WHEN the root layout renders
- THEN `<ClerkProvider>` MUST wrap all child routes
- AND `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` MUST be accessible

### Requirement: Route Protection

A `middleware.ts` MUST protect the chat UI (`/`) and profile routes. Unauthenticated requests MUST redirect to `/sign-in` preserving the original URL as `redirect_url`. Public routes (`/sign-in`, `/sign-up`) MUST bypass auth.

#### Scenario: Unauthenticated user redirected

- GIVEN a user without a valid Clerk session
- WHEN they request `/`
- THEN they MUST be redirected to `/sign-in?redirect_url=%2F`

#### Scenario: Public routes bypass

- GIVEN any user (authenticated or not)
- WHEN they request `/sign-in` or `/sign-up`
- THEN the page MUST render without auth checks

### Requirement: Sign-In and Sign-Up Pages

The app MUST provide pages at `/sign-in` and `/sign-up` using Clerk's `<SignIn />` and `<SignUp />` components. Post-auth redirect MUST go to `/` (the chat UI, since the app's main page renders AIAssistantUI at root).

#### Scenario: Successful sign-in

- GIVEN an unauthenticated user on `/sign-in`
- WHEN they complete the sign-in flow
- THEN they MUST be redirected to `/`

#### Scenario: Sign-up creates org

- GIVEN a new user on `/sign-up`
- WHEN they complete registration
- THEN a Clerk Organization SHOULD be created for multi-tenant isolation
- AND they MUST be redirected to `/`

### Requirement: Dynamic Token Injection

The `api-client.js` module MUST obtain the Clerk session token via `useAuth().getToken()` on each request. The client MUST NOT rely on `NEXT_PUBLIC_API_KEY` as primary auth. If `getToken()` returns null and no `NEXT_PUBLIC_API_KEY` fallback is configured, the request MUST fail with `AUTH_REQUIRED`.

> **Note**: The `NEXT_PUBLIC_API_KEY` fallback in `authHeaders()` exists as a development convenience for local setups where Clerk is not fully configured. In production (Docker), this env var is typically unset, so the fallback produces no Authorization header and the backend returns 401.

#### Scenario: Token obtained from Clerk

- GIVEN an authenticated Clerk session
- WHEN `api-client.js` prepares a request
- THEN it MUST call `getToken()` for the current session JWT

#### Scenario: No session token

- GIVEN an unauthenticated state
- WHEN `api-client.js` attempts a request
- THEN it MUST fail with `AUTH_REQUIRED` error

### Requirement: Authorization Header

Every API request MUST include `Authorization: Bearer <token>` where `<token>` is the Clerk JWT from `getToken()`. The middleware MUST extract the token from the `Authorization` header using the `Bearer` scheme. If the `Authorization` header is missing, the middleware MUST fall back to the `X-API-Key` header (legacy, transition only). If neither header is present, the request MUST return 401.

#### Scenario: Bearer header present

- GIVEN an authenticated session with a valid JWT
- WHEN `api-client.js` POSTs to `/v1/chat/message`
- THEN the `Authorization` header MUST contain `Bearer <jwt>`

#### Scenario: Missing auth header

- GIVEN a request without `Authorization` or `X-API-Key` headers
- WHEN the middleware inspects the request
- THEN status MUST be 401

#### Scenario: Wrong auth scheme

- GIVEN a request with `Authorization: Basic dXNlcjpwYXNz`
- WHEN the middleware inspects the header
- THEN status MUST be 401

### Requirement: Clerk JWT Extraction

The auth middleware MUST support a `ClerkJWTExtractor` that validates Clerk JWTs. It MUST fetch the JWKS from Clerk, verify the JWT signature, and extract `org_id` and `sub` claims. An invalid or expired JWT MUST return 401.

#### Scenario: Valid Clerk JWT

- GIVEN a request with `Authorization: Bearer <valid_clerk_jwt>`
- WHEN `ClerkJWTExtractor` processes it
- THEN the JWT signature MUST be verified against Clerk's JWKS
- AND `org_id` and `sub` MUST be extracted from claims

#### Scenario: Expired JWT

- GIVEN a request with an expired Clerk JWT
- WHEN `ClerkJWTExtractor` processes it
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"TOKEN_EXPIRED"`

#### Scenario: Invalid signature

- GIVEN a tampered JWT
- WHEN `ClerkJWTExtractor` processes it
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"TOKEN_INVALID"`

### Requirement: JWKS Caching

The middleware MUST cache Clerk's JWKS in Redis with a 1-hour TTL. The JWKS MUST be fetched on first request and served from cache on subsequent requests. A cache miss MUST trigger a fresh fetch from Clerk.

#### Scenario: JWKS from cache

- GIVEN JWKS was cached 10 minutes ago
- WHEN a Clerk JWT request arrives
- THEN verification MUST use the cached JWKS
- AND no external fetch to Clerk is made

#### Scenario: Cache miss

- GIVEN no JWKS in Redis
- WHEN the first Clerk JWT request arrives
- THEN the middleware MUST fetch JWKS from Clerk
- AND cache it in Redis with TTL 3600s

### Requirement: Coexistence with API Key Auth

Both `ApiKeyExtractor` and `ClerkJWTExtractor` MUST run in sequence. `ApiKeyExtractor` MUST be tried first (checks for `fa_` prefix). If it does not match, `ClerkJWTExtractor` MUST process the token. If both fail, 401 MUST be returned.

#### Scenario: API key takes priority

- GIVEN `Authorization: Bearer fa_abc123...`
- WHEN extractors run in sequence
- THEN `ApiKeyExtractor` MUST handle it (detects `fa_` prefix)
- AND `ClerkJWTExtractor` MUST be skipped

#### Scenario: Clerk JWT handled by Clerk extractor

- GIVEN `Authorization: Bearer <clerk_jwt>` (no `fa_` prefix)
- WHEN `ApiKeyExtractor` does not match
- THEN `ClerkJWTExtractor` MUST process the JWT
- AND on success, the request MUST proceed

#### Scenario: Both fail

- GIVEN an invalid token (not a valid API key nor Clerk JWT)
- WHEN both extractors fail
- THEN status MUST be 401
- AND `ApiError.code` MUST be `"UNAUTHORIZED"`

### Requirement: Organization Mapping

The Clerk Organization ID (`org_id`) MUST be mapped to the internal `tenant_id` via `TenantStore`. The `useChat` hook MUST use the current org context. If no org is active, a personal tenant namespace SHOULD be derived from the user ID.

#### Scenario: Org scoped to tenant

- GIVEN an authenticated user with an active Clerk Organization
- WHEN the frontend makes an API request
- THEN the JWT `org_id` claim MUST be used as `tenant_id`
- AND the backend MUST resolve the tenant from this claim

#### Scenario: No org selected

- GIVEN an authenticated user without an active organization
- WHEN they make an API request
- THEN a personal tenant namespace SHOULD be derived from `sub` (user ID)

#### Scenario: org_id resolves via TenantStore

- GIVEN a Clerk JWT with `org_id: "org_123"`
- WHEN resolved via `TenantStore.get("org_123")`
- THEN the internal `tenant_id` MUST be returned
- AND `request.state.tenant_id` MUST be set

#### Scenario: Personal scope fallback

- GIVEN a Clerk JWT without `org_id`
- WHEN the middleware processes it
- THEN a personal tenant SHOULD be derived from `sub`

### Requirement: Conversation Persistence

The system MUST persist conversations via the backend API (`POST /v1/chat/conversations/save`), auto-saving per message exchange. On load, conversations MUST be fetched from `GET /v1/chat/conversations`. localStorage conversations SHOULD be migrated to the backend on first login. An empty list MUST show an empty state.

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

#### Scenario: Default values

- GIVEN no `.env.local` file
- WHEN the frontend starts
- THEN `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000`

#### Scenario: Clerk key present

- GIVEN `.env.local` has `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- WHEN ClerkProvider initializes
- THEN the key MUST be available to Clerk
