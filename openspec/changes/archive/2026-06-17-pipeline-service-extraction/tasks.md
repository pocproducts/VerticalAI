# Tasks: Pipeline Service Extraction

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~310 (additions + deletions) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr-default |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: single-pr
400-line budget risk: Low

## Phase 1: Foundation — New Modules + Config

- [x] 1.1 **config.py** — add `CERT_DIR`, `CERT_PATH`, `KEY_PATH`, `REPRESENTANTE_CUIT` as module-level constants after `get_settings()`:
  ```python
  CERT_DIR = Path('.certificados-arca')
  CERT_PATH = CERT_DIR / 'produccion.crt'
  KEY_PATH = CERT_DIR / 'produccion.key'
  REPRESENTANTE_CUIT = get_settings().credentials.cuit
  ```
  Import `Path`, move the helper after `get_settings()`.

- [x] 1.2 **pipeline/models.py** — create `PipelineResult(BaseModel)` with exact field names matching current dict: `cliente: str`, `cuit: str`, `ws_api: bool = False`, `calendario: bool = False`, `pdf: bool = False`, `pdf_path: str | None = None`, `email: bool = False`, `error: str | None = None`.

- [x] 1.3 **pipeline/service.py** — create `PipelineService` class:
  - `__init__(self, engine: RulesEngine, pdf_gen: PdfGenerator, memory_client: FiscalMemoryClient | None = None)`
  - `run_pipeline()` method with same signature as `_procesar_cliente_pipeline()` except `echo_func` renamed to `progress_callback: Callable[[str], None] | None = None` (default `None` → no-op lambda)
  - Move `_completar_cliente_desde_padron()` here as module-level function (preserves same logic, same imports)
  - Move `_memory_save_extraction()` here as private helper
  - Inside `run_pipeline()`: replace raw dict with `PipelineResult(...)`, use `progress_callback` instead of `echo_func`, replace `typer.echo` default with no-op

- [x] 1.4 **pipeline/__init__.py** — export `PipelineService`, `PipelineResult`, `_completar_cliente_desde_padron`

## Phase 2: Integration — Wire All Callers

- [x] 2.1 **cli.py** — remove local `CERT_DIR`, `CERT_PATH`, `KEY_PATH`, `REPRESENTANTE_CUIT`. Add `from fiscal_agent.config import CERT_DIR, CERT_PATH, KEY_PATH, REPRESENTANTE_CUIT`. Make `_procesar_cliente_pipeline()` a thin wrapper delegating to `PipelineService.run_pipeline()`.
  Add re-export `from fiscal_agent.pipeline.service import PipelineService, _completar_cliente_desde_padron` for backward compat.

- [x] 2.2 **api/deps.py** — remove local `CERT_DIR`, `CERT_PATH`, `KEY_PATH`, `REPRESENTANTE_CUIT`. Add `from fiscal_agent.config import CERT_DIR, CERT_PATH, KEY_PATH, REPRESENTANTE_CUIT`.

- [x] 2.3 **api/routes/chat.py** — change imports from `fiscal_agent.cli` to `fiscal_agent.pipeline.service` for both `PipelineService` and `_completar_cliente_desde_padron`. Keep `_procesar_cliente_pipeline` import unchanged for backward compat.

- [x] 2.4 **api/routes/report.py** — change imports from `fiscal_agent.cli` to `fiscal_agent.pipeline.service`. Switch `_completar_cliente_desde_padron` to new module; replace `_procesar_cliente_pipeline` call with direct `PipelineService.run_pipeline()` usage.

- [x] 2.5 **mcp/tools/pipeline.py** — change import: replace `from fiscal_agent.cli import REPRESENTANTE_CUIT, _procesar_cliente_pipeline` with `from fiscal_agent.config import REPRESENTANTE_CUIT` and `from fiscal_agent.pipeline.service import PipelineService`. Create `PipelineService` instance and call `run_pipeline()` instead of `_procesar_cliente_pipeline()`.

- [x] 2.6 **7 MCP tools** (`deuda.py`, `facilidades.py`, `registro.py`, `rentas.py`, `taxpayer.py`, `report.py`, `calendar.py`) — change import `from fiscal_agent.cli import REPRESENTANTE_CUIT` → `from fiscal_agent.config import REPRESENTANTE_CUIT`.

## Phase 3: Verification

- [ ] 3.1 **Unit test** — `PipelineResult.model_dump()` keys match: `assert set(result.model_dump().keys()) == {'cliente', 'cuit', 'ws_api', 'calendario', 'pdf', 'pdf_path', 'email', 'error'}`
- [ ] 3.2 **Unit test** — `PipelineService.run_pipeline()` with full mock deps: mock WS, Engine, Browser, PDF, Email. Assert all result fields populated correctly.
- [ ] 3.3 **Smoke test** — run `python -m pytest fiscal_agent/tests/` to verify no import breaks
- [ ] 3.4 **Manual verification** — CLI `run` and `report` commands produce identical output (user runs commands below)

## Dependency Graph

```
1.1 config.py ──────────────────────────────┐
                                            │
1.2 pipeline/models.py ──────┐              │
                             │              │
1.3 pipeline/service.py ◄────┘              │
         │                                  │
1.4 pipeline/__init__.py ◄──┘               │
         │                                  │
         ├──► 2.1 cli.py ◄──────────────────┘
         ├──► 2.2 api/deps.py ◄─────────────┘
         ├──► 2.3 api/routes/chat.py
         ├──► 2.4 api/routes/report.py
         ├──► 2.5 mcp/tools/pipeline.py
         └──► 2.6 7 MCP tools ◄────────────┘
```

All Phase 2 tasks are independent of each other (they just change imports).

## Verification Commands (manual execution)

```bash
# 1. Import check — nothing broken
python -m pytest fiscal_agent/tests/ -x --tb=short

# 2. Lint
ruff check fiscal_agent/pipeline/ fiscal_agent/config.py fiscal_agent/cli.py fiscal_agent/api/ fiscal_agent/mcp/tools/

# 3. Manual CLI smoke test (requires .env + certs)
# python -m fiscal_agent validate
# python -m fiscal_agent run --config clients.yaml --no-send

# 4. Verify PipelineResult field names match
python -c "
from fiscal_agent.pipeline.models import PipelineResult
r = PipelineResult(cliente='test', cuit='20332837796')
keys = set(r.model_dump().keys())
expected = {'cliente','cuit','ws_api','calendario','pdf','pdf_path','email','error'}
assert keys == expected, f'Mismatch: {keys ^ expected}'
print('OK — keys match')
"
```

## Delivery Strategy

Single PR. Estimated ~310 changed lines is under the 400-line budget. All changes are import rewiring + mechanical extraction with zero behavioral change.
