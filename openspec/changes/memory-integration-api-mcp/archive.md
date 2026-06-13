# Archive: Memory Integration — API + MCP

## Status
✅ COMPLETED — FiscalMemoryClient integrado en API REST y MCP Server.

## Context
El SDD cycle `engram-memory-and-dockerization` dejó la memoria persistente funcionando solo en el CLI. Hoy se extendió a los otros dos entry points.

## Files Changed

| File | Action | Change |
|------|--------|--------|
| `api/deps.py` | MODIFIED | Agregado `FiscalMemoryClient` como singleton cacheado vía `get_memory()` |
| `api/routes/extract.py` | MODIFIED | Save extraction results + pipeline errors a Engram |
| `api/routes/report.py` | MODIFIED | Save padron results + pipeline + PDF generado |
| `mcp/server.py` | MODIFIED | `FiscalMemoryClient` en lifespan context |
| `mcp/tools/deuda.py` | MODIFIED | Save deuda extraction + errors |
| `mcp/tools/facilidades.py` | MODIFIED | Save facilidades extraction + errors |
| `mcp/tools/registro.py` | MODIFIED | Save registro extraction + errors |
| `mcp/tools/report.py` | MODIFIED | Save padron + deuda + PDF + errors |
| `.env` | MODIFIED | `REDIS_URL` y `MEMORY_REDIS_CACHE_URL` apuntan a Redis Cloud |

## Memory Coverage

| Entry Point | Padrón | Extractions | PDF | Errors |
|-------------|--------|-------------|-----|--------|
| CLI (cli.py) | ✅ | ✅ | ✅ | ✅ |
| API REST | ✅ | ✅ | ✅ | ✅ |
| MCP Server | ✅ | ✅ | ✅ | ✅ |

## Redis Cloud
Conectado a base **FIscalAgent** (30MB, AWS us-east-1) en Redis Cloud.
