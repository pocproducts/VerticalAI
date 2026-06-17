# Design: Pipeline Service Extraction

## Technical Approach

**Additive refactor**: extract the pipeline orchestration from `cli.py` into a dedicated `PipelineService` class. Keep `_procesar_cliente_pipeline()` as a thin backward-compatible wrapper that delegates to the service. No behavioral changes — all three entry points (CLI, API, MCP) produce identical output.

```
┌─────────────────────────────────────────────────────────┐
│  Before:  cli.py owns pipeline logic + API/MCP import   │
│           from cli.py directly                           │
│                                                          │
│  After:   PipelineService lives in fiscal_agent/pipeline/│
│           CLI delegates, API/MCP import from new module  │
│           Old function stays as wrapper                  │
└─────────────────────────────────────────────────────────┘
```

## Architecture Decisions

| Decision | Choice | Alternatives | Rationale |
|----------|--------|--------------|-----------|
| **Service constructor** | Inject `RulesEngine`, `PdfGenerator`, `FiscalMemoryClient` | Create deps inside the service | Follows existing pattern (`api/deps.py`). Makes testing trivial — mock the deps, not the env. |
| **Progress reporting** | Optional `progress_callback: Callable[[str], None]` param on `run_pipeline()` | Events, streams, logging-only | Keeps the exact same `echo_func` pattern. API SSE relies on this. Simpler than a full event system for phase 1. |
| **PipelineResult format** | Pydantic `BaseModel` with same field names as current dict | New namespace, nested model | Zero breakage for consumers that access `resultado["pdf"]` etc. `model_dump()` produces identical dict. |
| **`_completar_cliente_desde_padron`** | Move to `pipeline/service.py` as module-level function | Keep in cli.py, move elsewhere | Used independently by API routes (before calling pipeline). Belongs with pipeline domain, not CLI. |
| **echo_func default** | `None` → no-op (not typer.echo) | Keep `typer.echo` default | Service shouldn't know about Typer. Callers pass their own callback. CLI passes `typer.echo`, API SSE passes `_progress()`. |
| **Config constants** | Add `CERT_DIR`, `CERT_PATH`, `KEY_PATH`, `REPRESENTANTE_CUIT` to `config.py` | Single settings class | Eliminates duplication between `cli.py` and `api/deps.py`. Single import for all consumers. |

## Data Flow

```
CLI (run/report)          API (POST /v1/report)      MCP (run_pipeline)
       │                         │                         │
       │                         │                         │
       └──────────┬──────────────┴─────────────┬───────────┘
                  │                            │
                  ▼                            │
      PipelineService.run_pipeline()           │
                  │                            │
       ┌──────────┼──────────┬──────────┐      │
       ▼          ▼          ▼          ▼      │
    WS ARCA   Rules     Browser    PDF Gen     │
    SOAP/A5   Engine    Composio   + Email     │
       │          │          │          │       │
       └──────────┴──────────┴──────────┘       │
                  │                             │
                  ▼                             ▼
          PipelineResult ← dict/JSON to consumers
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/pipeline/__init__.py` | **Create** | Public exports: `PipelineService`, `PipelineResult` |
| `fiscal_agent/pipeline/service.py` | **Create** | `PipelineService` class with `run_pipeline()` + `_completar_cliente_desde_padron()` |
| `fiscal_agent/pipeline/models.py` | **Create** | `PipelineResult(BaseModel)` — typed pipeline output |
| `fiscal_agent/config.py` | **Modify** | Add `CERT_DIR`, `CERT_PATH`, `KEY_PATH`, `REPRESENTANTE_CUIT` constants |
| `fiscal_agent/cli.py` | **Modify** | `_procesar_cliente_pipeline()` → thin wrapper delegating to `PipelineService`. Remove local `CERT_PATH`/`REPRESENTANTE_CUIT`. Import from `config`. |
| `fiscal_agent/api/deps.py` | **Modify** | Remove local `CERT_PATH`/`KEY_PATH`/`REPRESENTANTE_CUIT`. Import from `config`. |
| `fiscal_agent/api/routes/chat.py` | **Modify** | Import `PipelineService` + `_completar_cliente_desde_padron` from `pipeline.service`. Remove imports from `cli`. |
| `fiscal_agent/api/routes/report.py` | **Modify** | Same pattern — import from `pipeline.service`, not `cli`. |
| `fiscal_agent/mcp/tools/pipeline.py` | **Modify** | Import `PipelineService` from `pipeline.service`, constants from `config`. |
| `fiscal_agent/mcp/tools/deuda.py` | **Modify** | Import `REPRESENTANTE_CUIT` from `config`, not `cli`. |
| `fiscal_agent/mcp/tools/facilidades.py` | **Modify** | Same |
| `fiscal_agent/mcp/tools/registro.py` | **Modify** | Same |
| `fiscal_agent/mcp/tools/rentas.py` | **Modify** | Same |
| `fiscal_agent/mcp/tools/taxpayer.py` | **Modify** | Same |
| `fiscal_agent/mcp/tools/report.py` | **Modify** | Same |
| `fiscal_agent/mcp/tools/calendar.py` | **Modify** | Same |

## Interfaces / Contracts

```python
# ── pipeline/models.py ──────────────────────────────────────

class PipelineResult(BaseModel):
    """Typed pipeline output — field names match the existing dict."""
    cliente: str                    # nombre or CUIT
    cuit: str
    ws_api: bool = False
    calendario: bool = False
    pdf: bool = False
    pdf_path: str | None = None
    email: bool = False
    error: str | None = None

# ── pipeline/service.py ─────────────────────────────────────

class PipelineService:
    def __init__(
        self,
        engine: RulesEngine,
        pdf_gen: PdfGenerator,
        memory_client: FiscalMemoryClient | None = None,
    ): ...

    def run_pipeline(
        self,
        cliente: ClientConfig,
        token: str,
        sign: str,
        mes: int,
        anio: int,
        browser: ComposioBrowser | None = None,
        *,
        with_deuda: bool = False,
        with_facilidades: bool = False,
        with_registro: bool = False,
        with_iibb: bool = False,
        send_email: bool = True,
        config: AppConfig | None = None,
        output_dir: Path | None = None,
        progress_callback: Callable[[str], None] | None = None,
    ) -> PipelineResult: ...

# ── config.py additions ─────────────────────────────────────

CERT_DIR = Path('.certificados-arca')
CERT_PATH = CERT_DIR / 'produccion.crt'
KEY_PATH = CERT_DIR / 'produccion.key'

@property
def REPRESENTANTE_CUIT(self) -> str:
    return self.credentials.cuit
```

## Sequence Diagram

```
 Caller                PipelineService           WS ARCA/Rules/PDF     MemoryClient
   │                         │                         │                   │
   │── run_pipeline() ──────►│                         │                   │
   │                         │── check padron hist ───►│                   │
   │                         │←────────────────────────│                   │
   │                         │── consultar_cuit ──────►│                   │
   │                         │←────────────────────────│                   │
   │                         │── save_padron_result ──────────────────────►│
   │                         │── engine.calcular ─────►│                   │
   │                         │←────────────────────────│                   │
   │                         │── [browser tasks] ─────►│                   │
   │                         │←────────────────────────│                   │
   │                         │── save_extraction ─────────────────────────►│
   │                         │── pdf_gen.generar ─────►│                   │
   │                         │←────────────────────────│                   │
   │                         │── save_pdf_sent ───────────────────────────►│
   │                         │── email (if enabled) ──►│                   │
   │                         │── save_pdf_sent ───────────────────────────►│
   │                         │── save_pipeline_error ─────────────────────►│ (on exception)
   │◄── PipelineResult ──────│                         │                   │
```

## Backward Compatibility

1. **`_procesar_cliente_pipeline()`** stays in `cli.py` as:
   ```python
   def _procesar_cliente_pipeline(..., echo_func=None) -> dict:
       svc = PipelineService(engine, pdf_gen, memory_client)
       result = svc.run_pipeline(..., progress_callback=echo_func)
       return result.model_dump()
   ```
   No existing import breaks — API and MCP still work unchanged until re-pointed.

2. **`PipelineResult.model_dump()`** returns the exact same dict keys (`cliente`, `cuit`, `ws_api`, `calendario`, `pdf`, `pdf_path`, `email`, `error`). All consumers that read these keys continue to work.

3. **`_completar_cliente_desde_padron`** remains importable from `cli.py` (re-exported from `pipeline/service`) during transition. Phase 2 updates imports.

4. **Rollback**: `git revert` + delete `fiscal_agent/pipeline/`. The wrapper in `cli.py` ensures the old code path is always available.

## Verification Plan

| Layer | What | How |
|-------|------|-----|
| Unit | `PipelineResult` serialization | Assert `model_dump()` returns dict with same keys as current code |
| Unit | `PipelineService.run_pipeline()` with mocks | Mock WS, Rules, PDF, Email. Verify result fields match. |
| Integration | CLI `run` output identical | Run old path + new path on test config, compare dicts |
| Integration | CLI `report` output identical | Same with output_dir param |
| Integration | API `POST /v1/report` response | Hit endpoint, compare JSON keys with expected |
| E2E | MCP `run_pipeline` | Run tool, verify `UnifiedResponse` wraps `PipelineResult` |

## Open Questions

- [ ] `_completar_cliente_desde_padron`: keep a re-export in `cli.py` during transition, or update all callers in the same PR? (Proposal says additive — keep re-export)
- [ ] `deuda` command: out of scope, but should we at least note in the `cli.py` wrapper doc that it's a separate path not yet unified?
- [ ] `REPRESENTANTE_CUIT` in config: should it be a `@cached_property` on `AppSettings` or a module-level `lru_cache`d function? Module-level constant loaded from settings is simplest for now.
