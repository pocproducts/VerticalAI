# Archive Report: memoria-core

**Archived**: 2026-06-13
**Change**: memoria-core
**Status**: ✅ Complete — all tasks implemented, verified, and archived
**Verification**: PASS (all warnings corrected pre-archive)

## Summary

Implementación de la capa de memoria fiscal: API REST endpoints públicos,
MCP tools de lectura/escritura, y `TenantBrain` — el cerebro central que
correlaciona padrón + deuda + facilidades + registro + calendario + matching
para un CUIT en un `TenantContext` unificado.

## Capabilities Implemented

| Capability | Description | Status |
|------------|-------------|--------|
| `memory-rest-api` | `GET /v1/memory/{cuit}`, `GET /v1/memory/{cuit}/{obs_type}`, `POST /v1/memory/observe` con `run_in_executor` + `ScopeRequired` + `UnifiedResponse` | ✅ |
| `memory-mcp-tools` | `get_memory_history(cuit, obs_type?, limit)` y `save_memory_observation(cuit, title, type, content)` vía `ctx.lifespan_context['memory']` | ✅ |
| `tenant-brain` | `TenantBrain.build_context(cuit)` → `TenantContext` con 8 fuentes best-effort, `_match_rentas()` refactorizado de `matching.py` | ✅ |
| `rest-api` (modified) | Requirements 7-10 agregados a tabla de endpoints + escenarios | ✅ |

## Files Created

| File | Description |
|------|-------------|
| `fiscal_agent/memory/models.py` | `MemoryObservation`, `MemoryQueryRequest`, `MemoryQueryResponse`, `MemoryObserveRequest`, `TenantContext` — Pydantic v2 |
| `fiscal_agent/memory/brain.py` | `TenantBrain` class con `build_context()` + `_match_rentas()` |
| `fiscal_agent/api/routes/memory.py` | Router FastAPI con 3 endpoints + `run_in_executor` |
| `fiscal_agent/mcp/tools/memory.py` | 2 MCP tools para lectura/escritura de memoria |
| `openspec/specs/memory-rest-api/spec.md` | Main spec — Memory REST API |
| `openspec/specs/memory-mcp-tools/spec.md` | Main spec — MCP tools de memoria |
| `openspec/specs/tenant-brain/spec.md` | Main spec — Tenant Brain |

## Files Modified

| File | Description |
|------|-------------|
| `fiscal_agent/matching.py` | `evaluar_rentas_cordoba()` → thin wrapper que delega a `TenantBrain._match_rentas()` |
| `fiscal_agent/mcp/server.py` | Import de `fiscal_agent.mcp.tools.memory` |
| `fiscal_agent/api/server.py` | Inclusión de `memory.router` con tag `'memory'` |
| `openspec/specs/rest-api/spec.md` | Requirements 7-10 agregados (tabla + escenarios) |

## Architecture Decisions Applied

| AD | Decision |
|----|----------|
| AD 1 | `asyncio.to_thread` para sync→async bridge (consistente con `mcp/tools/deuda.py`) |
| AD 2 | `TenantBrain` co-located en `memory/brain.py` (cohesión con `FiscalMemoryClient`) |
| AD 3 | `matching.py` refactorizado como `_match_rentas()` interno, thin wrapper público |
| AD 4 | Best-effort en brain, no fail-fast (try/except por source, `ultimo_error`) |

## Tests Added

| Test File | Scope |
|-----------|-------|
| `fiscal_agent/tests/test_memory_models.py` | Model validation (content max 10 KB, CUIT min_length, TenantContext defaults) |
| `fiscal_agent/tests/test_tenant_brain.py` | `build_context()` happy path, partial failure ARCA, partial failure Engram, CUIT vacío |
| `fiscal_agent/tests/test_memory_api.py` | API endpoints con `TestClient`: happy path GET/POST, invalid CUIT, validation error, auth fallback |
| `fiscal_agent/tests/test_memory_mcp.py` | MCP tools con mock lifespan: happy path read/write, Engram unavailable, limit param |
| Existing matching tests adapted | `_match_rentas()` output idéntico a `evaluar_rentas_cordoba()` |

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `rest-api` | Updated (during apply) | Requirements 7-10: GET/POST memory endpoints + scopes |
| `memory-rest-api` | Created | Main spec desde delta — 6 requirements, 12 scenarios |
| `memory-mcp-tools` | Created | Main spec desde delta — 3 requirements, 8 scenarios |
| `tenant-brain` | Created | Main spec desde delta — 6 requirements, 9 scenarios |

## Delta Merge Summary

### rest-api (existing main spec)

The delta spec defined Requirements 7-10 (ADDED). The main spec was updated
during apply phase and already contains all requirements. Verified no
discrepancies between delta and main spec.

### memory-rest-api (new domain)

Full spec copied to main specs `openspec/specs/memory-rest-api/spec.md`.

### memory-mcp-tools (new domain)

Full spec copied to main specs `openspec/specs/memory-mcp-tools/spec.md`.

### tenant-brain (new domain)

Full spec copied to main specs `openspec/specs/tenant-brain/spec.md`.

## Archive Contents

```
openspec/changes/archive/2026-06-13-memoria-core/
├── proposal.md
├── design.md
├── tasks.md
├── archive.md
└── specs/
    ├── rest-api/
    │   └── spec.md          # Delta spec (ADDED Requirements 7-10)
    ├── memory-rest-api/
    │   └── spec.md          # Full spec
    ├── memory-mcp-tools/
    │   └── spec.md          # Full spec
    └── tenant-brain/
        └── spec.md          # Full spec
```

## SDD Cycle Complete

The `memoria-core` change has been fully planned, proposed, specified,
designed, implemented, tested, verified, and archived.

## Próximos Pasos Sugeridos

1. **Memory scopes**: Implementar `memory:*` scopes en `Scope` enum (actualmente
   usa `admin:*` como fallback — ver AD 1 y Open Questions en design.md)
2. **Cache Redis**: Agregar cache CUIT + TTL 5min para `build_context()` (mencionado
   en proposal, diferido por no estar en specs)
3. **Tipado estricto**: Reemplazar `Any` en `TenantContext` con tipos concretos
   (`PadronA5Output`, etc.) cuando se refactorice el pipeline
4. **Paralelización**: Hacer `build_context()` async con `asyncio.gather()` para
   fuentes independientes
5. **Integration tests**: E2E con `FiscalMemoryClient` real contra Engram container
