# Archive: Redis Config Centralization

## Status
✅ COMPLETED — all tasks implemented and verified.

## Summary
Centralized Redis configuration and credentials loading using Pydantic `BaseSettings` in `fiscal_agent/config.py`. Eliminated 20+ scattered `os.environ.get` calls across 11 files.

## Files Changed
| File | Action | Lines |
|------|--------|-------|
| `fiscal_agent/config.py` | **CREATED** | 66 |
| `fiscal_agent/api/server.py` | MODIFIED | -2 +3 |
| `fiscal_agent/api/deps.py` | MODIFIED | -4 +2 |
| `fiscal_agent/cli.py` | MODIFIED | -6 +9 |
| `fiscal_agent/mcp/server.py` | MODIFIED | -3 +4 |
| `fiscal_agent/mcp/tools/deuda.py` | MODIFIED | -2 +2 |
| `fiscal_agent/mcp/tools/facilidades.py` | MODIFIED | -2 +2 |
| `fiscal_agent/mcp/tools/registro.py` | MODIFIED | -2 +2 |
| `fiscal_agent/mcp/tools/report.py` | MODIFIED | -2 +2 |
| `fiscal_agent/api/routes/extract.py` | MODIFIED | -3 +4 |
| `fiscal_agent/api/routes/report.py` | MODIFIED | -2 +3 |

Total changed lines: **~90** (new) + **~35** (modified) = **~125 lines**

## Remaining `os.getenv` calls (out of scope)
- 11 in `api/auth.py` — Auth0 (next cycle)
- 1 in `api/server.py` — Auth0 domain in OpenAPI schema (next cycle)
- 2 in `mcp/transport.py` — MCP transport config (separate concern)

## Backward Compatibility
All env var names unchanged:
- `REDIS_URL`, `MEMORY_REDIS_CACHE_URL`, `MEMORY_REDIS_MAX_MB` → `RedisConfig`
- `ESTUDIO_CUIT`, `ESTUDIO_CLAVE_FISCAL`, `COMPOSIO_API_KEY` → `Credentials`

The `.env` file needs no changes.

## Design Decisions
- **Nested Pydantic models** with `Field(alias=...)` for env vars that don't share a prefix
- **`@lru_cache` singleton** via `get_settings()` so repeated calls don't re-parse env vars
- **`extra='ignore'`** on all sub-models so adding new env vars doesn't break existing ones
