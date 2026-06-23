# Design: Provincia Router + IIBB Jujuy

## 1. File Layout

| Action | Path | Purpose |
|--------|------|---------|
| **REMOVED** | `fiscal_agent/browser/workflows/iibb.py` | Moves to subpackage; delete after migration |
| **NEW** | `fiscal_agent/browser/workflows/iibb/__init__.py` | Subpackage marker, re-exports both templates |
| **NEW** | `fiscal_agent/browser/workflows/iibb/cordoba.py` | Rename of `iibb.py` — exact same content, `TEMPLATE_IIBB` → `TEMPLATE_IIBB_CORDOBA` |
| **NEW** | `fiscal_agent/browser/workflows/iibb/jujuy.py` | Stub template Jujuy — login AFIP + "no implementada" + empty arrays |
| **NEW** | `fiscal_agent/browser/iibb_router.py` | Province → template NL lookup (dict + classmethod) |
| **MODIFIED** | `fiscal_agent/browser/workflows/__init__.py` | Import from `iibb/cordoba.py`, add `TEMPLATE_IIBB` backward-compat alias, add `__all__` entry |
| **MODIFIED** | `fiscal_agent/browser/task.py` | `IIBBTask.__init__` accepts `provincia`, resolves template via router |
| **MODIFIED** | `fiscal_agent/browser/factory.py` | `build_browser_tasks` accepts `provincia`, passes to `IIBBTask` |
| **MODIFIED** | `fiscal_agent/pipeline/service.py` | Derives `provincia` from `cliente.provincias`, passes to factory / inline `IIBBTask` |
| **UNCHANGED** | `fiscal_agent/browser/composio.py` | Reads `task.template` at runtime — no change needed |
| **UNCHANGED** | `fiscal_agent/matching.py` | Out of scope for this change |

## 2. IIBBRouter Design

**File:** `fiscal_agent/browser/iibb_router.py`

```python
"""Mapea nombre de provincia → template NL para extracción IIBB.

El router centraliza la selección del template en un solo punto.
Agregar una provincia nueva = agregar entrada al dict + crear el módulo template.
No requiere modificar el código cliente.
"""

from __future__ import annotations

from typing import ClassVar

from fiscal_agent.browser.workflows.iibb.cordoba import TEMPLATE_IIBB_CORDOBA
from fiscal_agent.browser.workflows.iibb.jujuy import TEMPLATE_IIBB_JUJUY


class IIBBRouter:
    """Selecciona template NL de IIBB según provincia.

    Uso:
        >>> IIBBRouter.get('CORDOBA')  # → TEMPLATE_IIBB_CORDOBA
        >>> IIBBRouter.get(None)        # → TEMPLATE_IIBB_CORDOBA (fallback)
        >>> IIBBRouter.get('DESCONOCIDA')  # → TEMPLATE_IIBB_CORDOBA (fallback)
    """

    _templates: ClassVar[dict[str, str]] = {
        'CORDOBA': TEMPLATE_IIBB_CORDOBA,
        'JUJUY': TEMPLATE_IIBB_JUJUY,
    }

    @classmethod
    def get(cls, provincia: str | None = None) -> str:
        """Retorna el template NL para la provincia indicada.

        Args:
            provincia: Nombre de provincia (case-insensitive).
                       None o vacío → Córdoba (fallback).

        Returns:
            Template string listo para Composio Browser Tool.
        """
        if not provincia:
            return cls._templates['CORDOBA']
        provincia_upper = provincia.upper().strip()
        return cls._templates.get(provincia_upper, cls._templates['CORDOBA'])
```

**Rationale (Ponytail rule):**
- Un `classmethod` + `ClassVar[dict]` es suficiente. No hay interfaz, no hay Strategy pattern, no hay inyección de dependencias.
- El dict es **finito y estático** — las provincias se conocen en build-time. No cambian en runtime.
- Si en el futuro hay 20+ provincias, este diseño sigue siendo válido. Se puede extraer a un archivo JSON/config si el dict crece, pero eso es premature optimization hoy.
- `ClassVar` sobre `_templates` deja explícito que es un mapping de clase, no de instancia (nunca se instancia `IIBBRouter`).

## 3. IIBBTask Refactor

**File:** `fiscal_agent/browser/task.py`

### Current (before)

```python
class IIBBTask(BrowserTask):
    name = 'iibb'
    template = TEMPLATE_IIBB          # ← class-level, hardcoded
    needs_auth = True
    timeout = 600
    start_url = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'

    def __init__(self, cuit: str, clave: str, cliente_cuit: str) -> None:
        self.template_params = {'cuit': cuit, 'clave': clave, 'cliente_cuit': cliente_cuit}
        self.secrets = {'auth.afip.gob.ar': f'{cuit}:{clave}'}
```

### New (after)

```python
class IIBBTask(BrowserTask):
    name = 'iibb'
    # NO class-level template — se resuelve en __init__ según provincia
    needs_auth = True
    timeout = 600
    start_url = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'

    def __init__(self, cuit: str, clave: str, cliente_cuit: str,
                 provincia: str = 'CORDOBA') -> None:
        self.template_params = {'cuit': cuit, 'clave': clave, 'cliente_cuit': cliente_cuit}
        self.secrets = {'auth.afip.gob.ar': f'{cuit}:{clave}'}
        self.template = IIBBRouter.get(provincia)
```

**Key changes:**
1. `provincia: str = 'CORDOBA'` — nuevo parámetro opcional
2. `self.template = IIBBRouter.get(provincia)` — resuelve el template en instancia (shadow de la class attribute)
3. Se elimina la class attribute `template = TEMPLATE_IIBB`
4. Import changes: `from fiscal_agent.browser.iibb_router import IIBBRouter`

**Why instance-level `self.template` works:**
- `composio.py` line 406: `instruction = task.template` — acceso a nivel instancia
- Python lookup: instance attribute → class attribute → descriptor → error
- `self.template = ...` en `__init__` pisa la class attribute para esa instancia
- Otras tasks (`VencimientosDeudasTask`, `FacilidadesTask`, etc.) siguen usando class attribute porque son invariantes por provincia

## 4. Pipeline Derivation

**File:** `fiscal_agent/pipeline/service.py`

### Derivation logic

```python
def _derive_iibb_provincia(cliente: ClientConfig) -> str | None:
    """Deriva la provincia para IIBB según las provincias configuradas.

    Regla:
    - None/vacío → None (dispara fallback Córdoba en IIBBRouter)
    - 1 provincia → esa provincia
    - 2+ provincias → primera (Convenio Multilateral)
    """
    if not cliente.provincias:
        return None
    return cliente.provincias[0]
```

### Integration points

**A) Via factory (`build_browser_tasks`):**

```python
# factory.py — modified
def build_browser_tasks(
    cuit: str,
    clave: str,
    cliente_cuit: str,
    *,
    with_deuda: bool = False,
    with_facilidades: bool = False,
    with_registro: bool = False,
    with_iibb: bool = False,
    provincia: str | None = None,              # ← nuevo
) -> list[BrowserTask]:
    tasks: list[BrowserTask] = []
    ...
    if with_iibb:
        tasks.append(IIBBTask(
            cuit=cuit, clave=clave, cliente_cuit=cliente_cuit,
            provincia=provincia or 'CORDOBA',   # ← pasa provincia
        ))
    return tasks
```

**B) Inline IIBBTask creation (pipeline/service.py line 219-226):**

```python
if with_iibb:
    provincia_iibb = _derive_iibb_provincia(cliente)  # None, "JUJUY", etc.
    tasks.append(IIBBTask(
        cuit=REPRESENTANTE_CUIT,
        clave=estudio_clave,
        cliente_cuit=cliente.cuit,
        provincia=provincia_iibb or 'CORDOBA',
    ))
```

**C) CLI / API entry points:**
No requieren cambios porque `build_browser_tasks` ya recibe `provincia` y el `PipelineService.run_pipeline` deriva internamente desde `cliente.provincias`. Los callers (CLI, MCP, API) solo pasan `with_iibb=True`.

## 5. Import Path Changes

### Before

```
fiscal_agent.browser.workflows.iibb        → TEMPLATE_IIBB
fiscal_agent.browser.workflows             → TEMPLATE_IIBB (re-export)
```

### After

```
fiscal_agent.browser.workflows.iibb.cordoba → TEMPLATE_IIBB_CORDOBA
fiscal_agent.browser.workflows.iibb.jujuy   → TEMPLATE_IIBB_JUJUY
fiscal_agent.browser.workflows.iibb         → (re-exports both from __init__.py)
fiscal_agent.browser.workflows              → TEMPLATE_IIBB = TEMPLATE_IIBB_CORDOBA (alias)
```

### Backward compat alias

In `fiscal_agent/browser/workflows/__init__.py`:

```python
from fiscal_agent.browser.workflows.iibb.cordoba import TEMPLATE_IIBB_CORDOBA
# ... other imports ...

# Backward-compatible alias — old code using `from workflows import TEMPLATE_IIBB`
# still works. Same string object (is check passes).
TEMPLATE_IIBB = TEMPLATE_IIBB_CORDOBA
```

**Why this works:** `TEMPLATE_IIBB = TEMPLATE_IIBB_CORDOBA` en `__init__.py` hace que `from fiscal_agent.browser.workflows import TEMPLATE_IIBB` resuelva al mismo objeto string que `TEMPLATE_IIBB_CORDOBA`. `is` check pasa porque Python asigna la referencia directa.

### All impacted imports

| File | Current import | New import |
|------|----------------|------------|
| `task.py` line 18 | `from fiscal_agent.browser.workflows import ... TEMPLATE_IIBB ...` | Same (backward compat), remove `TEMPLATE_IIBB` from import + add `from fiscal_agent.browser.iibb_router import IIBBRouter` |
| `workflows/__init__.py` | `from fiscal_agent.browser.workflows.iibb import TEMPLATE_IIBB` | `from fiscal_agent.browser.workflows.iibb.cordoba import TEMPLATE_IIBB_CORDOBA` |
| `factory.py` | N/A (no TEMPLATE_IIBB import) | Add `provincia` param — no new imports needed |
| `pipeline/service.py` | N/A (imports IIBBTask from browser) | Add derivation helper — no new imports needed |

## 6. Sequence Diagram

```
PipelineService                Factory/builder           IIBBRouter            IIBBTask
     │                            │                        │                    │
     │  run_pipeline(cliente)     │                        │                    │
     │───────────────────────────▶│                        │                    │
     │                            │                        │                    │
     │  _derive_iibb_provincia    │                        │                    │
     │  (cliente.provincias)      │                        │                    │
     │───────┐                    │                        │                    │
     │       │ None  → provincia  │                        │                    │
     │       │ 1     → provincias[0]                       │                    │
     │       │ 2+    → provincias[0]                       │                    │
     │◀──────┘                    │                        │                    │
     │                            │                        │                    │
     │  build_browser_tasks(      │                        │                    │
     │    with_iibb=True,         │                        │                    │
     │    provincia=provincia_iibb)                        │                    │
     │───────────────────────────▶│                        │                    │
     │                            │                        │                    │
     │                            │  IIBBTask(             │                    │
     │                            │    cuit, clave,        │                    │
     │                            │    cliente_cuit,       │                    │
     │                            │    provincia='JUJUY')  │                    │
     │                            │───────────────────────▶│                    │
     │                            │                        │                    │
     │                            │                        │  IIBBRouter.get(   │
     │                            │                        │    'JUJUY')        │
     │                            │                        │───────────────────▶│
     │                            │                        │                    │
     │                            │                        │  TEMPLATE_IIBB_    │
     │                            │                        │  JUJUY             │
     │                            │                        │◀───────────────────│
     │                            │                        │                    │
     │                            │  IIBBTask instance     │                    │
     │                            │  (template=JUJUY)      │                    │
     │                            │◀───────────────────────│                    │
     │                            │                        │                    │
     │  task list                 │                        │                    │
     │◀───────────────────────────│                        │                    │
     │                            │                        │                    │
     │  ComposioBrowser           │                        │                    │
     │  .run_single(tasks)        │                        │                    │
     │  → lee task.template       │                        │                    │
     │  → reemplaza placeholders  │                        │                    │
     │  → ejecuta en Composio     │                        │                    │
     │                            │                        │                    │
```

## 7. Jujuy Stub Template

**File:** `fiscal_agent/browser/workflows/iibb/jujuy.py`

```python
"""IIBB Jujuy extraction — STUB: login AFIP + report no implementada.

Placeholders: {cuit}, {clave}, {cliente_cuit}
"""

from __future__ import annotations

TEMPLATE_IIBB_JUJUY: str = """IIBB Jurisdicciones — DGR Jujuy (STUB)

--- PARTE 1: LOGIN ---

1. Abrí https://auth.afip.gob.ar/contribuyente_/login.xhtml
2. Ingresá CUIT: {cuit}
3. Click 'Siguiente'. Esperá campo contraseña.
4. Ingresá clave: {clave}
5. Click 'Ingresar'. Esperá redirección a URL con 'cloud.afip.gob.ar'.

SI VES: 'CUIT incorrecto', 'clave inválida' → reportá ERROR ARCA-4 y detené.
SI VES: 'código de verificación', '2FA' → reportá ERROR ARCA-6 y detené.

--- PARTE 2: STUB ---

6. DGR Jujuy no implementada aún.
   Reportá que la integración con DGR Jujuy está en desarrollo.
   No hay navegación a realizar.

--- PARTE 3: OUTPUT ---

7. Llamá al comando `done` con el JSON en el campo `text`:

done({{"text": "{{\\"iibb_jurisdicciones\\": [], \\"cuotas_vencidas\\": []}}", "success": true}})

No pongas texto adicional fuera del JSON.
"""

__all__ = ['TEMPLATE_IIBB_JUJUY']
```

This satisfies:
- Mismo login AFIP que Córdoba (misma detección ARCA-4/ARCA-6)
- Output parseable por `_parse_iibb_output()` (ambas keys vacías)
- `success: true` — el pipeline no ve error

## 8. Migration / Rollout

No hay breaking changes. La transición es segura:

1. **Crear** `iibb/__init__.py`, `iibb/cordoba.py`, `iibb/jujuy.py`, `iibb_router.py`
2. **Modificar** `workflows/__init__.py` — import de la nueva fuente + alias `TEMPLATE_IIBB`
3. **Modificar** `task.py` — import router, classmethod template resolution
4. **Modificar** `factory.py` + `pipeline/service.py` — pasar provincia
5. **Eliminar** `workflows/iibb.py`
6. **Verificar** `rg "from.*iibb[^_]"` no arroja imports huérfanos

**Rollback:** revertir commit. El alias `TEMPLATE_IIBB` en `workflows/__init__.py` existe mientras no se elimine `workflows/iibb/__init__.py`, pero si se revierte completo, todo vuelve al estado anterior.

## 9. Testing Strategy

| Scenario | What to assert |
|----------|----------------|
| `IIBBRouter.get('CORDOBA')` | Returns `TEMPLATE_IIBB_CORDOBA` (is check) |
| `IIBBRouter.get('JUJUY')` | Returns `TEMPLATE_IIBB_JUJUY` |
| `IIBBRouter.get(None)` | Returns `TEMPLATE_IIBB_CORDOBA` |
| `IIBBRouter.get('')` | Returns `TEMPLATE_IIBB_CORDOBA` |
| `IIBBRouter.get('DESCONOCIDA')` | Returns `TEMPLATE_IIBB_CORDOBA` |
| `IIBBRouter.get('cordoba')` | Case-insensitive: returns `TEMPLATE_IIBB_CORDOBA` |
| `IIBBRouter.get('Jujuy')` | Case-insensitive: returns `TEMPLATE_IIBB_JUJUY` |
| `IIBBTask(..., provincia='JUJUY')` | `self.template is TEMPLATE_IIBB_JUJUY` |
| `IIBBTask(...)` (sin provincia) | `self.template is TEMPLATE_IIBB_CORDOBA` |
| `build_browser_tasks(with_iibb=True, provincia='JUJUY')` | Task creada con template Jujuy |
| `build_browser_tasks(with_iibb=True)` (sin provincia) | Task creada con Córdoba |
| `build_browser_tasks(with_iibb=False, provincia='JUJUY')` | No se crea IIBBTask, no error |
| `from fiscal_agent.browser.workflows import TEMPLATE_IIBB` | `TEMPLATE_IIBB is TEMPLATE_IIBB_CORDOBA` (True) |
| Pipeline `cliente.provincias=None` | `provincia=None` → Córdoba |
| Pipeline `cliente.provincias=["JUJUY"]` | `provincia="JUJUY"` |
| Pipeline `cliente.provincias=["CORDOBA", "JUJUY"]` | `provincia="CORDOBA"` (primera) |
| `_parse_iibb_output('{"iibb_jurisdicciones":[], "cuotas_vencidas":[]}')` | Dict con ambas keys vacías (Jujuy stub) |
