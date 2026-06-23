# Deployment Hardening Specification

> **New capability** (2026-06-18). Defines dynamic CORS from environment
> variables, a production `.env.prod` template, and the `docker-compose.prod.yml`
> update to pass the new env var.

## Purpose

Replace the hardcoded CORS origins list in `server.py` with a
configurable `CORS_ORIGINS` env var, create a production-ready `.env.prod`
template, and wire everything through `docker-compose.prod.yml`.

## Requirements

### Requirement 1: CORS_ORIGINS env var in config.py

The `AppSettings` class in `config.py` MUST expose a `cors_origins` field
read from the `CORS_ORIGINS` env var.

The value MUST be a comma-separated list of origins (e.g.
`http://localhost:3000,http://localhost:3001`).

The parsed value MUST be a `list[str]`.

**Default:** `["http://localhost:3000", "http://localhost:3001"]` (local dev).

#### Scenario: Default CORS origins

- GIVEN no `CORS_ORIGINS` env var set
- WHEN `get_settings().cors_origins` is accessed
- THEN it MUST return `["http://localhost:3000", "http://localhost:3001"]`

#### Scenario: Custom CORS origins

- GIVEN `CORS_ORIGINS=https://app.example.com,https://admin.example.com`
- WHEN `get_settings().cors_origins` is accessed
- THEN it MUST return `["https://app.example.com", "https://admin.example.com"]`

#### Scenario: Single origin

- GIVEN `CORS_ORIGINS=https://app.example.com`
- WHEN `get_settings().cors_origins` is accessed
- THEN it MUST return `["https://app.example.com"]`

### Requirement 2: server.py reads CORS from config

The `CORSMiddleware` configuration in `server.py` MUST read `allow_origins`
from `get_settings().cors_origins` instead of the current hardcoded list.

#### Scenario: Server starts with configured origins

- GIVEN `CORS_ORIGINS=https://app.example.com`
- WHEN the server starts
- THEN `CORSMiddleware` MUST be configured with
  `allow_origins=["https://app.example.com"]`
- AND requests from `http://localhost:3000` MUST be rejected (not in list)

#### Scenario: Server starts with default origins

- GIVEN no `CORS_ORIGINS` env var
- WHEN the server starts
- THEN `CORSMiddleware` MUST be configured with
  `allow_origins=["http://localhost:3000", "http://localhost:3001"]`
- AND local development continues to work unchanged

### Requirement 3: .env.prod template

The project MUST include a `.env.prod` file at the project root as a
template for production deployment. It MUST include ALL required env vars
with placeholder values and documentation.

**Required vars:**

| Variable | Placeholder | Notes |
|----------|-------------|-------|
| `ESTUDIO_CUIT` | `"20111111110"` | CUIT del estudio contable |
| `ESTUDIO_CLAVE_FISCAL` | `""` | Clave fiscal — set via secure method |
| `COMPOSIO_API_KEY` | `""` | Composio API key |
| `CORS_ORIGINS` | `"https://app.example.com"` | Comma-separated allowed origins |
| `REDIS_URL` | `"redis://redis:6379/0"` | Internal Docker network URL |
| `DEV_API_KEY` | `""` | Leave EMPTY in production |
| `SMTP_HOST` | `""` | SMTP configuration |
| `SMTP_PORT` | `""` | SMTP port |
| `SMTP_USER` | `""` | SMTP user |
| `SMTP_PASSWORD` | `""` | SMTP password |
| `SMTP_FROM` | `""` | SMTP from address |
| `MEMORY_REDIS_CACHE_URL` | `"redis://redis:6379/0"` | Internal Docker network URL |
| `MEMORY_REDIS_MAX_MB` | `25` | Cache memory limit |
| `ENGRAM_JWT_SECRET` | `""` | Required for Engram cloud |
| `POSTGRES_PASSWORD` | `""` | Required for Postgres |

#### Scenario: .env.prod is valid

- GIVEN the `.env.prod` file at project root
- WHEN parsed by `AppSettings` (with `env_file='.env.prod'`)
- THEN all fields MUST have their default/placeholder values
- AND `CORS_ORIGINS` MUST be `"https://app.example.com"`

### Requirement 4: docker-compose.prod.yml passes CORS_ORIGINS

The `docker-compose.prod.yml` MUST add `CORS_ORIGINS` to the
`fiscal-agent` service's `environment` block, reading from the host's
`.env` file or an explicit env var.

#### Scenario: CORS_ORIGINS in compose env

- GIVEN `CORS_ORIGINS=https://app.example.com` in the host's `.env`
- WHEN `docker compose -f docker-compose.prod.yml up` runs
- THEN the `fiscal-agent` container MUST have `CORS_ORIGINS` set to
  `https://app.example.com`

#### Scenario: Fallback to default

- GIVEN NO `CORS_ORIGINS` in the host's `.env`
- WHEN `docker compose -f docker-compose.prod.yml up` runs
- THEN the `fiscal-agent` container MUST NOT have `CORS_ORIGINS` explicitly set
- AND the app's default (`localhost:3000,3001`) MUST be used

## File Manifest

| File | Change |
|------|--------|
| `fiscal_agent/config.py` | **Update** — add `cors_origins: list[str]` field from `CORS_ORIGINS` env var |
| `fiscal_agent/api/server.py` | **Update** — replace hardcoded `allow_origins` with `get_settings().cors_origins` |
| `.env.prod` | **New** — production env template |
| `docker-compose.prod.yml` | **Update** — pass `CORS_ORIGINS` to fiscal-agent service |
