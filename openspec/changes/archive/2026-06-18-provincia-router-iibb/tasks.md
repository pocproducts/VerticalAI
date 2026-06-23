# Tasks: Provincia Router + IIBB Jujuy

**Change:** `provincia-router-iibb`  
**Mode:** auto · OpenSpec · Single PR · 400 lines budget  
**Ponytail:** minimum code, no abstractions

---

## Review Workload Forecast

| Metric | Value |
|--------|-------|
| **New files** | 4 files, ~190 lines |
| **Modified files** | 4 files, ~30 lines changed |
| **Deleted files** | 1 file, ~107 lines removed |
| **Total review workload** | **~220 lines** (new + modified) |
| **Line budget** | 400 lines |
| **Budget used** | 55% |
| **Risk level** | **Low** |
| **Decision** | ✅ **Single PR** — fits well under 400-line budget. No risky refactors, Ponytail-compliant. |

### Risk assessment

| Risk | Level | Why |
|------|-------|-----|
| Orphaned imports | Low | `TEMPLATE_IIBB` backward compat alias in `workflows/__init__.py` ensures old import survives. `rg "from.*iibb[^_]"` catches stragglers. |
| Pipeline without provincia | Low | Default `None` → router fallback to Córdoba. Same behavior as today. |
| Import cycle | Low | `iibb_router.py` imports templates; `task.py` imports router. No cycle because `iibb_router` does not import `task`. |
| Code churn | Low | ~220 lines, mostly new files. Modified files have focused 3-5 line changes each. |

---

## Task Inventory

### Task 1: Create `workflows/iibb/` subpackage ✅

**Dependencies:** None  
**Estimate:** ~10 lines (new file)  
**Files:**

- **CREATE** `fiscal_agent/browser/workflows/iibb/__init__.py` (~10 lines)

Subpackage marker that re-exports both province templates:

```python
"""IIBB workflow templates by province."""
from __future__ import annotations

from fiscal_agent.browser.workflows.iibb.cordoba import TEMPLATE_IIBB_CORDOBA
from fiscal_agent.browser.workflows.iibb.jujuy import TEMPLATE_IIBB_JUJUY

__all__ = ['TEMPLATE_IIBB_CORDOBA', 'TEMPLATE_IIBB_JUJUY']
```

**Verification:**
- `from fiscal_agent.browser.workflows.iibb import TEMPLATE_IIBB_CORDOBA` works
- `from fiscal_agent.browser.workflows.iibb import TEMPLATE_IIBB_JUJUY` works

---

### Task 2: Move `workflows/iibb.py` → `workflows/iibb/cordoba.py`, rename constant ✅

**Dependencies:** Task 1 (subpackage must exist)  
**Estimate:** ~107 lines (new file, move + rename)  
**Files:**

- **CREATE** `fiscal_agent/browser/workflows/iibb/cordoba.py` (~107 lines)

Exact copy of `fiscal_agent/browser/workflows/iibb.py` with:
- `TEMPLATE_IIBB` → `TEMPLATE_IIBB_CORDOBA` (constant name)
- Docstring updated to reference Córdoba specifically
- `__all__ = ['TEMPLATE_IIBB_CORDOBA']`

Content identical to original — same placeholders, same navigation steps, same output format.

**Verification:**
- `TEMPLATE_IIBB_CORDOBA` is a non-empty string
- `TEMPLATE_IIBB_CORDOBA == TEMPLATE_IIBB` (old constant) is `True`

---

### Task 3: Create Jujuy stub template ✅

**Dependencies:** Task 1 (subpackage must exist)  
**Estimate:** ~30 lines (new file)  
**Files:**

- **CREATE** `fiscal_agent/browser/workflows/iibb/jujuy.py` (~30 lines)

Stub template with:
- `TEMPLATE_IIBB_JUJUY` constant
- Same AFIP login flow as Córdoba (same ARCA-4/ARCA-6 detection)
- Step reporting "DGR Jujuy no implementada aún"
- Output: `done({"text": "{\"iibb_jurisdicciones\": [], \"cuotas_vencidas\": []}", "success": true})`
- `__all__ = ['TEMPLATE_IIBB_JUJUY']`

**Verification:**
- `TEMPLATE_IIBB_JUJUY` is a non-empty string
- Output JSON parses via `_parse_iibb_output()` returning both keys as empty lists
- `success: true` — pipeline does not see error

---

### Task 4: Create `IIBBRouter` class ✅

**Dependencies:** Tasks 2, 3 (router imports both template constants)  
**Estimate:** ~45 lines (new file)  
**Files:**

- **CREATE** `fiscal_agent/browser/iibb_router.py` (~45 lines)

```python
class IIBBRouter:
    _templates: ClassVar[dict[str, str]] = {
        'CORDOBA': TEMPLATE_IIBB_CORDOBA,
        'JUJUY': TEMPLATE_IIBB_JUJUY,
    }

    @classmethod
    def get(cls, provincia: str | None = None) -> str:
        # None/vacío → Córdoba (fallback)
        # Case-insensitive match
        # Unknown → Córdoba (fallback)
```

**Ponytail rationale:** Single classmethod + ClassVar dict. No Strategy pattern, no DI, no interface. Finite static mapping known at build-time. Adding a province = one dict entry + one module.

**Verification:**
- `IIBBRouter.get('CORDOBA')` → `TEMPLATE_IIBB_CORDOBA` (is check)
- `IIBBRouter.get('JUJUY')` → `TEMPLATE_IIBB_JUJUY`
- `IIBBRouter.get(None)` → `TEMPLATE_IIBB_CORDOBA`
- `IIBBRouter.get('')` → `TEMPLATE_IIBB_CORDOBA`
- `IIBBRouter.get('DESCONOCIDA')` → `TEMPLATE_IIBB_CORDOBA`
- `IIBBRouter.get('cordoba')` → case-insensitive: `TEMPLATE_IIBB_CORDOBA`
- `IIBBRouter.get('Jujuy')` → case-insensitive: `TEMPLATE_IIBB_JUJUY`

---

### Task 5: Update `workflows/__init__.py` with backward compat alias ✅

**Dependencies:** Tasks 1, 2 (sources must exist)  
**Estimate:** ~5 lines changed (1 file modified)  
**Files:**

- **MODIFY** `fiscal_agent/browser/workflows/__init__.py` (~5 lines changed)

Changes:
1. Replace `from fiscal_agent.browser.workflows.iibb import TEMPLATE_IIBB`  
   → `from fiscal_agent.browser.workflows.iibb.cordoba import TEMPLATE_IIBB_CORDOBA`
2. Add `from fiscal_agent.browser.workflows.iibb.jujuy import TEMPLATE_IIBB_JUJUY`
3. Add `TEMPLATE_IIBB = TEMPLATE_IIBB_CORDOBA` (backward compat alias)
4. Update `__all__`: add `'TEMPLATE_IIBB_CORDOBA'`, `'TEMPLATE_IIBB_JUJUY'`

**Verification:**
- `from fiscal_agent.browser.workflows import TEMPLATE_IIBB` still works
- `TEMPLATE_IIBB is TEMPLATE_IIBB_CORDOBA` → `True`
- `from fiscal_agent.browser.workflows import TEMPLATE_IIBB_CORDOBA` works
- `from fiscal_agent.browser.workflows import TEMPLATE_IIBB_JUJUY` works

---

### Task 6: Update `IIBBTask` to accept provincia and use router ✅

**Dependencies:** Task 4 (router must exist)  
**Estimate:** ~8 lines changed (1 file modified)  
**Files:**

- **MODIFY** `fiscal_agent/browser/task.py` (~8 lines changed)

Changes:
1. Remove `TEMPLATE_IIBB` from the workflow import line (line 18)
2. Add `from fiscal_agent.browser.iibb_router import IIBBRouter`
3. Remove class-level `template = TEMPLATE_IIBB` from `IIBBTask` class (line 482)
4. Change `__init__` signature: add `provincia: str = 'CORDOBA'` parameter
5. Add `self.template = IIBBRouter.get(provincia)` inside `__init__`

```python
class IIBBTask(BrowserTask):
    name = 'iibb'
    # template resolved per-instance via IIBBRouter
    needs_auth = True
    timeout = 600
    start_url = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'

    def __init__(self, cuit: str, clave: str, cliente_cuit: str,
                 provincia: str = 'CORDOBA') -> None:
        self.template_params = {...}
        self.secrets = {...}
        self.template = IIBBRouter.get(provincia)
```

**Why instance-level `self.template` works:** Python instance attribute shadows class attribute. `composio.py` reads `task.template` at instance level — no change needed.

**Verification:**
- `IIBBTask(cuit=..., clave=..., cliente_cuit=..., provincia='JUJUY')` → `self.template is TEMPLATE_IIBB_JUJUY`
- `IIBBTask(cuit=..., clave=..., cliente_cuit=...)` (no provincia) → `self.template is TEMPLATE_IIBB_CORDOBA`
- `IIBBTask(cuit=..., clave=..., cliente_cuit=..., provincia='CORDOBA')` → `self.template is TEMPLATE_IIBB_CORDOBA`
- `self.name`, `self.needs_auth`, `self.timeout` unchanged
- `parse_output()` unchanged

---

### Task 7: Update `build_browser_tasks` to accept provincia ✅

**Dependencies:** Task 6 (IIBBTask must accept provincia)  
**Estimate:** ~5 lines changed (1 file modified)  
**Files:**

- **MODIFY** `fiscal_agent/browser/factory.py` (~5 lines changed)

Changes:
1. Add `provincia: str | None = None` keyword parameter
2. Pass `provincia=provincia or 'CORDOBA'` to `IIBBTask`

```python
def build_browser_tasks(
    cuit: str,
    clave: str,
    cliente_cuit: str,
    *,
    with_deuda: bool = False,
    with_facilidades: bool = False,
    with_registro: bool = False,
    with_iibb: bool = False,
    provincia: str | None = None,    # ← new
) -> list[BrowserTask]:
    ...
    if with_iibb:
        tasks.append(IIBBTask(
            cuit=cuit, clave=clave, cliente_cuit=cliente_cuit,
            provincia=provincia or 'CORDOBA',   # ← passes provincia
        ))
```

**Verification:**
- `build_browser_tasks(..., with_iibb=True, provincia='JUJUY')` → IIBBTask with `provincia='JUJUY'`
- `build_browser_tasks(..., with_iibb=True)` (no provincia) → IIBBTask default `'CORDOBA'`
- `build_browser_tasks(..., with_iibb=False, provincia='JUJUY')` → no IIBBTask, no error

---

### Task 8: Update pipeline to derive provincia from `cliente.provincias` ✅

**Dependencies:** Task 7 (factory must accept provincia)  
**Estimate:** ~12 lines changed (1 file modified)  
**Files:**

- **MODIFY** `fiscal_agent/pipeline/service.py` (~12 lines changed)

Changes:

1. Add module-level helper `_derive_iibb_provincia()` (~8 lines):

```python
def _derive_iibb_provincia(cliente: ClientConfig) -> str | None:
    """Deriva provincia para IIBB según provincias configuradas.

    - None/vacío → None (dispara fallback Córdoba en IIBBRouter)
    - 1 provincia → esa provincia
    - 2+ provincias → primera (Convenio Multilateral)
    """
    if not cliente.provincias:
        return None
    return cliente.provincias[0]
```

2. Modify inline IIBBTask creation in `run_pipeline()` (lines 219-226) to pass provincia:

```python
if with_iibb:
    provincia_iibb = _derive_iibb_provincia(cliente)
    tasks.append(IIBBTask(
        cuit=REPRESENTANTE_CUIT,
        clave=estudio_clave,
        cliente_cuit=cliente.cuit,
        provincia=provincia_iibb or 'CORDOBA',
    ))
```

**Verification:**
- `cliente.provincias=None` → `provincia=None` → IIBBRouter fallback Córdoba
- `cliente.provincias=[]` → `provincia=None` → Córdoba
- `cliente.provincias=["JUJUY"]` → `provincia="JUJUY"`
- `cliente.provincias=["CORDOBA", "JUJUY"]` → `provincia="CORDOBA"` (first)

---

### Task 9: Remove old `workflows/iibb.py` ✅

**Dependencies:** Task 5 (backward compat alias must be active to catch any remaining imports)  
**Estimate:** 0 lines added, ~107 lines removed (deletion only)  
**Files:**

- **DELETE** `fiscal_agent/browser/workflows/iibb.py`

Run pre-merge check:
```
rg "from.*iibb[^_]" fiscal_agent/ --no-filename | sort -u
```
Should return zero results (all imports now point to `iibb.cordoba`, `iibb.jujuy`, or use the backward-compat alias from `workflows/__init__.py`).

**Verification:**
- Module does not exist at old path
- `from fiscal_agent.browser.workflows import TEMPLATE_IIBB` still works (backward compat alias)
- All imports in the project resolve correctly
