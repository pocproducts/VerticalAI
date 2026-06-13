# Archive: engram-memory-and-dockerization

## Status
✅ COMPLETED

## Summary
Feature00 — Memoria persistente con Engram por CUIT + Dockerización completa.

## What Was Built

### memory-engram
- `fiscal_agent/memory/__init__.py` — exports FiscalMemoryClient, MemoryConfig
- `fiscal_agent/memory/config.py` — MemoryConfig(BaseSettings) con env_prefix MEMORY_
- `fiscal_agent/memory/client.py` — FiscalMemoryClient con sesiones por CUIT, WRITE (4), READ (4), cache Redis con TTLs, best-effort

### docker-infrastructure
- `Dockerfile` — python:3.11-slim + uv
- `docker-compose.yml` — 3 servicios (fiscal-agent, engram, redis) con healthchecks

### Modificaciones
- `fiscal_agent/cli.py` — hooks de memoria en pipeline
- `.env` — nuevas vars MEMORY_*
- `pyproject.toml` — +pydantic-settings

### Tests
- 29 tests en `fiscal_agent/tests/test_memory.py`
- Cobertura: config, WRITE, READ, cache, best-effort, Redis space, lazy init, sessions

## Key Decisions
- AD1: requests sync (no httpx) — pipeline sync
- AD2: redis.Redis sync — pipeline sync
- AD3: Cache integrado en client (no módulo separado)
- AD4: pip install uv en Dockerfile
- AD5: Engram healthcheck en :7437
- AD6: agent_id = CUIT en toda operación

## Architecture
Cada CUIT tiene su propia sesión Engram (cuit-{cuit}) con observaciones aisladas. Redis cachea lecturas frecuentes con TTLs. Best-effort: si Engram o Redis fallan, el pipeline sigue.

## Files
| File | Action |
|------|--------|
| fiscal_agent/memory/__init__.py | Created |
| fiscal_agent/memory/config.py | Created |
| fiscal_agent/memory/client.py | Created |
| fiscal_agent/cli.py | Modified |
| Dockerfile | Created |
| docker-compose.yml | Created |
| .env | Modified |
| pyproject.toml | Modified |
| fiscal_agent/tests/test_memory.py | Created |

## Verification
- Static review: PASS WITH WARNINGS (1 CRITICAL fixed: Redis URL en Docker)
- Manual test: ✅ Engram guarda y recupera memorias por CUIT
- Best-effort: ✅ Redis caído no rompe pipeline

## Next Steps
- Configurar Redis productivo con credenciales
- Auth0 integration
- Tenant brain (cerebro central del tenant)
- API REST endpoints de memoria
- MCP tools de memoria
