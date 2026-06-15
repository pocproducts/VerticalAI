# Design: memoria-core

## Technical Approach

Tres capacidades orquestadas en torno a `FiscalMemoryClient` (sync, best-effort) con
un puente async vía `run_in_executor` para REST endpoints. `TenantBrain` agrega
todas las fuentes fiscales de un CUIT en un `TenantContext` unificado, llamando
secuencialmente a cada origen y tolerando fallos parciales (best-effort).

```
┌─────────────────────────────────────────────────────────┐
│                     TenantBrain                          │
│  build_context(cuit) → TenantContext                     │
│                                                          │
│  ┌────────┐ ┌────────┐ ┌──────────┐ ┌───────────────┐  │
│  │ padron │ │ deuda  │ │facilides │ │ calendario    │  │
│  └────────┘ └────────┘ └──────────┘ └───────────────┘  │
│  ┌──────────────┐ ┌──────────────────┐                  │
│  │ registro     │ │ _match_rentas()  │                  │
│  └──────────────┘ └──────────────────┘                  │
│  ┌───────────────────────────────────┐                  │
│  │ FiscalMemoryClient (mem_hist)    │                  │
│  └───────────────────────────────────┘                  │
└──────────┬──────────────────────────────────────────────┘
           │
           ▼
    TenantContext (Pydantic v2)
```

```
API REST (FastAPI)                MCP Tools (FastMCP)
     │                                  │
     │ run_in_executor                  │ ctx.lifespan_context
     ▼                                  ▼
FiscalMemoryClient (sync, requests)
     │
     ├── Engram (HTTP API)
     └── Redis cache (fakeredis/real)
```

## Architecture Decisions

### AD 1: `run_in_executor` para sync→async bridge

| Option | Tradeoff | Decisión |
|--------|----------|----------|
| `asyncio.to_thread` | Python 3.9+, mismo mecanismo | ✅ Elegido |
| `loop.run_in_executor(None, fn)` | Más verbose, igual semántica | ❌ |
| Hacer `FiscalMemoryClient` async | Refactor masivo de ~400 líneas, rompe CLI sync | ❌ |

**Rationale**: `FiscalMemoryClient` es sync por diseño (usa `requests`, `redis` sync).
Hacerlo async implicaría reescribir toda la capa de persistencia y perder
compatibilidad con CLI sync. `asyncio.to_thread` es el wrapper stdlib estándar,
usado ya en `mcp/tools/deuda.py` línea 55. Consistencia con el codebase.

### AD 2: TenantBrain co-located en `memory/`

| Option | Tradeoff | Decisión |
|--------|----------|----------|
| `memory/brain.py` | Acceso directo a `FiscalMemoryClient`, cohesivo | ✅ Elegido |
| `fiscal_agent/brain.py` | Top-level prematuro, sin dependencias compartidas | ❌ |
| `fiscal_agent/core/` | Nueva carpeta sin justificación | ❌ |

**Rationale**: `TenantBrain` consume `FiscalMemoryClient` como dependencia
principal. Co-locarlo en `memory/` mantiene cohesión y evita crear carpetas
nuevas sin necesidad. Si el brain creciera en el futuro, se extrae a su
propio módulo. Por ahora, YAGNI.

### AD 3: Refactor de `matching.py` como método interno

| Option | Tradeoff | Decisión |
|--------|----------|----------|
| Método `_match_rentas()` en brain | Llamada directa sin imports extra | ✅ Elegido |
| Dejar `matching.py` standalone | Duplica lógica, brain necesita wrapper | ❌ |
| Mover a `memory/matching.py` | Ruido de archivos, solo 1 consumidor | ❌ |

**Rationale**: `evaluar_rentas_cordoba()` tiene un solo consumidor real:
`TenantBrain.build_context()`. Refactorizarlo como `_match_rentas()` evita
el acoplamiento import→función. Se mantiene thin wrapper en `matching.py`
para no romper imports existentes (spec requiere compatibilidad).

### AD 4: Best-effort en brain, no fail-fast

| Option | Tradeoff | Decisión |
|--------|----------|----------|
| Best-effort con `None`/`[]` por source | Resiliente, contexto parcial útil | ✅ Elegido |
| Fail-fast en primera falla | Pierde datos de sources exitosos | ❌ |
| Timeout + retry por source | Complejidad adicional, deferred v2 | ❌ |

**Rationale**: Las specs Require 2 (tenant-brain) especifican explícitamente:
"Errors in one source MUST NOT fail the entire context". Cada fuente se
envuelve en try/except, el error se registra en el campo correspondiente y
se continua con la siguiente fuente. `ultimo_error` captura el primer error
para visibilidad.

## Data Flow

### GET /v1/memory/{cuit} — Listar observaciones

```
Client ──GET /v1/memory/{cuit}──→ FastAPI Router
  │                                    │
  │ ← ScopeRequired(ADMIN_READ) ────── │
  │                                    │
  │                         asyncio.to_thread(
  │                           memory.get_pipeline_history(cuit)
  │                         )
  │                                    │
  │                         FiscalMemoryClient._search_observations()
  │                           → GET /search?q={cuit}&session_id=cuit-{cuit}
  │                                    │
  │ ← UnifiedResponse(observations) ── │
```

### POST /v1/memory/observe — Crear observación

```
Client ──POST /v1/memory/observe ──→ FastAPI Router
  │  {cuit, title, type, content}       │
  │ ← ScopeRequired(ADMIN_WRITE) ────── │
  │                                     │
  │   Pydantic valida → MemoryObserveRequest
  │                                     │
  │                         asyncio.to_thread(
  │                           memory._engram_post(/observations, body)
  │                         )
  │                                     │
  │ ← UnifiedResponse 201 ──────────── │
```

### TenantBrain.build_context(cuit)

```
build_context(cuit) ──→
  ├── 1. padron = get_padron_history(cuit)        # best-effort → None si falla
  ├── 2. deuda = get_extraction_history(cuit, 'deuda')
  ├── 3. facilidades = get_extraction_history(cuit, 'facilidades')
  ├── 4. registro = get_extraction_history(cuit, 'registro')
  ├── 5. calendario = rules_engine.calcular(cuit)  # RulesOutput
  ├── 6. rentas_matching = _match_rentas(cuit, padron, registro)
  ├── 7. memoria_historica = get_pipeline_history(cuit)
  └── 8. resumen_ejecutivo = _generar_resumen(...)  # texto plano
```

Cada paso envuelto en `try/except`. Si falla, se setea el campo a `None`/`[]`
y se acumula en `ultimo_error`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/memory/models.py` | **Create** | `MemoryObservation`, `MemoryQueryRequest`, `MemoryQueryResponse`, `MemoryObserveRequest`, `TenantContext` |
| `fiscal_agent/memory/brain.py` | **Create** | `TenantBrain` class con `build_context()` y `_match_rentas()` |
| `fiscal_agent/api/routes/memory.py` | **Create** | Router FastAPI con 3 endpoints + `run_in_executor` |
| `fiscal_agent/mcp/tools/memory.py` | **Create** | `get_memory_history` + `save_memory_observation` MCP tools |
| `fiscal_agent/matching.py` | **Modify** | `evaluar_rentas_cordoba()` → thin wrapper que delega a `TenantBrain._match_rentas()` |
| `fiscal_agent/mcp/server.py` | **Modify** | Import `memory` tools (línea ~107, junto a `report`) |
| `fiscal_agent/api/server.py` | **Modify** | Incluir `memory.router` con tag `'memory'` |
| `openspec/specs/rest-api/spec.md` | **Modify** | Agregar Requirements 7-10 a la spec existente |

## Interfaces / Contracts

### Modelos Pydantic (en `memory/models.py`)

```python
from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class MemoryObservation(BaseModel):
	"""Una observación de memoria fiscal para un CUIT."""
	id: int | None = None
	cuit: str
	title: str
	type: str
	content: str
	created_at: datetime | None = None


class MemoryQueryRequest(BaseModel):
	cuit: str
	obs_type: str | None = None
	limit: int = 10


class MemoryQueryResponse(BaseModel):
	observations: list[dict] = Field(default_factory=list)


class MemoryObserveRequest(BaseModel):
	cuit: str = Field(min_length=11, max_length=11)
	title: str = Field(min_length=1)
	type: str = Field(default='generic')
	content: str = Field(max_length=10_240)  # 10 KB max


class TenantContext(BaseModel):
	"""Contexto fiscal completo de un CUIT — best-effort, puede tener campos None."""
	padron: Any | None = None  # PadronA5Output o dict
	deuda: list[dict] = Field(default_factory=list)
	facilidades: list[dict] = Field(default_factory=list)
	registro: Any | None = None   # RegistroOutput o dict
	calendario: Any | None = None # RulesOutput o dict
	rentas_matching: Any | None = None
	memoria_historica: list[dict] = Field(default_factory=list)
	ultimo_error: dict | None = None
	resumen_ejecutivo: str = ''
```

### API Endpoints

| Method | Path | Scope | Request | Response |
|--------|------|-------|---------|----------|
| GET | `/v1/memory/{cuit}` | `admin:*` | path param | `UnifiedResponse[list]` |
| GET | `/v1/memory/{cuit}/{obs_type}` | `admin:*` | path params | `UnifiedResponse[list]` |
| POST | `/v1/memory/observe` | `admin:*` | `MemoryObserveRequest` | `UnifiedResponse` (201) |

### MCP Tools

| Tool | Params | Returns |
|------|--------|---------|
| `get_memory_history` | `cuit`, `obs_type?`, `limit=10` | `UnifiedResponse` JSON string |
| `save_memory_observation` | `cuit`, `title`, `type`, `content` | `UnifiedResponse` JSON string |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit (models) | `MemoryObserveRequest` validation, `TenantContext` defaults | Pytest + Pydantic assert, verificar campo `max_length` en content (10 KB) |
| Unit (brain) | `build_context()` con mock de `FiscalMemoryClient`, verificar best-effort | Mock client, injectar `ConnectionError` en un source, verificar otros campos poblados |
| Unit (brain) | `_match_rentas()` comportamiento idéntico al refactor | Copiar tests existentes de `matching.py`, verificar output contra `evaluar_rentas_cordoba()` |
| Unit (API) | Endpoints con `TestClient`, mock `get_memory()` para evitar Engram real | FastAPI `TestClient` + `ScopeRequired` mockeado |
| Unit (MCP) | Tools con mock de `ctx.request_context.lifespan_context` | Mock lifespan context, verificar `UnifiedResponse` parseable |
| Integration | End-to-end con `FiscalMemoryClient` real contra Engram container | Solo CI con Engram levantado (scope: deferred) |

## Migration / Rollout

No migration required. `matching.py` refactor mantiene API pública mediante thin
wrapper — imports existentes no se rompen. Los nuevos archivos (`memory/models.py`,
`memory/brain.py`, `api/routes/memory.py`, `mcp/tools/memory.py`) son aditivos.

Rollback: revertir los archivos nuevos. `matching.py` vuelve a su versión anterior.

## Open Questions

- [ ] `memory:*` scopes en `Scope` enum: difiero a otro cambio. Por ahora `admin:*`
      como fallabck explícito (OK según specs).
- [ ] Cache Redis para `build_context()`: el proposal menciona cache CUIT+TTL 5min,
      pero las specs no lo requieren. Difiero a futura optimización.
- [ ] `TenantContext` usa `Any` para tipos complejos (`PadronA5Output`, etc.) para
      evitar import circular pesado. ¿Vale la pena tipado estricto desde el vamos?
      Propuesta: `Any` ahora, reemplazar con tipos concretos cuando se refactorice
      el pipeline.
