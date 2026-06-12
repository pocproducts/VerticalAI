# Rate Limiting Specification

## Purpose

Proteger la API contra abuso mediante rate limiting in-memory por API key, configurable desde el Plan del developer. Sin base de datos — los límites se reinician al reiniciar el servidor.

## Requirements

### Requirement 1: Rate limits from Plan

Rate limits MUST be read from `Plan.rate_limit_rpm` (requests per minute) and `Plan.rate_limit_rpd` (requests per day).

#### Scenario: Enterprise plan limits

- GIVEN a plan with `rate_limit_rpm=1000` and `rate_limit_rpd=50000`
- WHEN the middleware resolves the plan for a request
- THEN the window counters MUST use 1000 RPM and 50000 RPD limits

### Requirement 2: Fixed window in memory

The rate limiter MUST use a fixed-window algorithm with per-API-key counters in memory.

#### Scenario: Count resets after window

- GIVEN a Free plan (10 RPM)
- WHEN 10 requests arrive in minute N
- AND the 11th request arrives in minute N+1
- THEN the 11th request MUST succeed (new window)

### Requirement 3: 429 with standard headers

Exceeded rate limits MUST return 429 with `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`.

#### Scenario: Rate limit exceeded returns correct headers

- GIVEN a Free plan (10 RPM)
- WHEN 11 requests arrive within the same minute window
- THEN the 11th request MUST return 429
- AND `Retry-After` MUST indicate seconds until reset
- AND `X-RateLimit-Limit` MUST be `"10"`
- AND `X-RateLimit-Remaining` MUST be `"0"`
- AND `UnifiedResponse.status` MUST be `"error"`
- AND `ApiError.code` MUST be `"RATE_LIMIT_EXCEEDED"`

### Requirement 4: Default Free plan limits

Any developer assigned to the default "Free" plan MUST have 10 RPM and 100 RPD.

#### Scenario: Free plan default values

- GIVEN a developer created via `POST /v1/admin/register`
- WHEN no explicit plan is assigned
- THEN the developer's plan MUST be Free
- AND the rate limiter MUST enforce 10 RPM and 100 RPD

### Requirement 5: In-memory only — resets on restart

No database persistence. All counters reset when the server restarts.

#### Scenario: Server restart clears counters

- GIVEN a rate limiter that received 5 requests
- WHEN the server is restarted
- THEN all counters MUST be zero
- AND the next request MUST be the first in a new window

### Requirement 6: Per-API-key counters

Each API key MUST have independent rate limit counters.

#### Scenario: Independent key counters

- GIVEN two API keys `key_a` and `key_b`, both on Free plan
- WHEN `key_a` exhausts its 10 RPM
- THEN requests with `key_b` MUST still succeed
- AND requests with `key_a` MUST return 429
