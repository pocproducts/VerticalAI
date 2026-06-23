# Rate Limiting Specification — Redis Sliding Window + ASGI Middleware

> Updated 2026-06-18: Replaced in-memory fixed-window with Redis-backed
> sliding windows and an ASGI middleware that runs after auth. Counters now
> persist across server restarts (Redis persistence).

## Purpose

Protect the API against abuse via Redis-backed sliding window rate limiting
per API key. Limits are read from the resolved `Plan`. The middleware runs
after authentication so `request.state.plan` and `request.state.api_key` are
available.

## Data Contract

Rate limit function already implemented at `fiscal_agent/api/rate_limiter.py`
— `check_rate_limit(redis, api_key_id, plan)` returns `{allowed, limit,
remaining, retry_after}`. This spec describes the middleware wrapper.

## Requirements

### Requirement 1: Post-auth ASGI middleware

The rate limiter middleware MUST run AFTER the auth middleware (so
`request.state.api_key` and `request.state.plan` are available) and BEFORE
the route handler.

#### Scenario: Middleware order

- GIVEN a valid authenticated request
- WHEN the middleware stack processes the request
- THEN auth middleware runs first (sets `request.state`)
- THEN rate limiter middleware runs (reads `request.state`)
- THEN the route handler runs

### Requirement 2: Call `check_rate_limit()` with resolved plan

The middleware MUST call `fiscal_agent.api.rate_limiter.check_rate_limit()`
with the Redis client from `app.state.redis`, the `api_key_id` from
`request.state.api_key.id`, and the `Plan` from `request.state.plan`.

#### Scenario: Rate limit check invoked

- GIVEN a request with `request.state.api_key.id = "key_01"` and
  `request.state.plan` with `rate_limit_rpm=100`
- WHEN the middleware invokes `check_rate_limit()`
- THEN the call MUST use `redis`, `"key_01"`, and the plan object
- AND the function MUST return `{allowed: bool, limit: int, remaining: int, retry_after: int}`

### Requirement 3: 429 with standard headers on exceeded limit

When `check_rate_limit()` returns `allowed=False`, the middleware MUST return
HTTP 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset` headers.

#### Scenario: Rate limit exceeded returns correct headers

- GIVEN a Free plan (10 RPM) with 10 requests already in the current window
- WHEN the 11th request arrives
- THEN the middleware returns 429
- AND `Retry-After` header MUST be the integer seconds until reset (from
  `retry_after`)
- AND `X-RateLimit-Limit` header MUST be `"10"`
- AND `X-RateLimit-Remaining` header MUST be `"0"`
- AND `X-RateLimit-Reset` header MUST be the Unix timestamp the current
  window expires (calculated as `now + retry_after`)
- AND `UnifiedResponse.status` MUST be `"error"`
- AND `UnifiedResponse.error.code` MUST be `"RATE_LIMIT_EXCEEDED"`

### Requirement 4: Pass-through when allowed

When `check_rate_limit()` returns `allowed=True`, the middleware MUST add
informational headers and pass the request through to the handler.

#### Scenario: Within limits, headers attached

- GIVEN a plan with 100 RPM and only 5 requests in the current window
- WHEN a new request arrives
- THEN the middleware MUST call `call_next(request)` (do NOT block)
- AND the response MUST include `X-RateLimit-Limit`, `X-RateLimit-Remaining`
- AND the response MUST have status 200 (from the handler)

### Requirement 5: Skip health endpoint

The rate limiter MUST skip all checks for `GET /v1/health` — this endpoint
must always respond without rate limiting.

#### Scenario: Health endpoint bypass

- GIVEN a request to `GET /v1/health`
- WHEN the rate limiter middleware inspects the path
- THEN `check_rate_limit()` MUST NOT be called
- AND the request MUST pass through to the handler

### Requirement 6: Redis sliding window (replaces in-memory)

The rate limiter MUST use Redis Sorted Sets for sliding windows as already
implemented in `check_rate_limit()`. Two windows per API key:

- **Minute window** (60s): limits from `Plan.rate_limit_rpm`
- **Day window** (86400s): limits from `Plan.rate_limit_rpd`

#### Scenario: Count resets after sliding window

- GIVEN a Free plan (10 RPM)
- WHEN 10 requests arrive within 60 seconds
- AND the 11th request arrives 61 seconds after the FIRST request
- THEN the 11th request MUST succeed (the first entry fell out of the window)

#### Scenario: Independent key counters (Redis)

- GIVEN two API keys `key_a` and `key_b`, both on Free plan
- WHEN `key_a` exhausts its 10 RPM
- THEN requests with `key_b` MUST still succeed
- AND requests with `key_a` MUST return 429

#### Scenario: Server restart preserves counters

- GIVEN a rate limiter that received 5 requests
- WHEN the server is restarted
- THEN all counters persist (Redis persistence)
- AND rate limiting continues from where it left off

### Requirement 7: Default Free plan limits (fallback)

Any developer assigned to the default "Free" plan MUST have 10 RPM and
100 RPD. If no plan is resolved for the API key, the rate limiter MUST fall
back to these defaults.

#### Scenario: No plan resolved

- GIVEN a valid API key but `request.state.plan` is `None`
- WHEN the middleware calls `check_rate_limit()` with `plan=None`
- THEN the internal defaults apply: 10 RPM, 100 RPD

## Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-R1 | Rate limit check latency | MUST complete <10ms (Redis local network) |
| NFR-R2 | Redis persistence | Counters persist across app restarts (unlike old in-memory) |
| NFR-R3 | TTL auto-cleanup | Redis keys auto-expire after 2× window size |

## File Manifest

| File | Change |
|------|--------|
| `fiscal_agent/api/middleware/rate_limit.py` | **New** — ASGI rate limiter middleware |
| `fiscal_agent/api/middleware/__init__.py` | Update — export `RateLimitMiddleware` |
| `fiscal_agent/api/server.py` | Update — wire `RateLimitMiddleware` after auth |
| `fiscal_agent/api/rate_limiter.py` | No change — already implemented |
