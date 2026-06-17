# Tasks: Task System Decoupling

## 1. Review Workload Forecast

| Metric | Value | Notes |
|--------|-------|-------|
| **New files** | 3 | `tasks/__init__.py`, `tasks/base.py`, `tasks/padron.py` |
| **Modified files** | 7 | `browser/task.py`, `browser/__init__.py`, `composio.py`, `cli.py`, `extract.py`, `deuda.py`, `report.py` |
| **Estimated new lines** | ~135 | Phase 1: BaseTask + ApiTask + PadronApiTask |
| **Estimated modified lines** | ~54 | Phase 2+3: rebase + rename en 7 archivos |
| **Estimated total delta** | **~189 lines** | Net additions + modifications (deletions excluded) |
| **Review budget** | **400 lines** | Configurado por el usuario (`review_budget_lines=400`) |
| **Budget risk** | **LOW — 47% del presupuesto** | Sobra ~211 líneas de margen |

**Riesgos identificados:**
- **Test files**: No hay tests unitarios actuales para `FullTask` o `TaskResult`. Cero riesgo de breakage en tests existentes.
- **README.md**: Menciona `FullTask` en el tree (línea 119). Cambio cosmético, no incluido en tareas.
- **Archived specs**: `openspec/changes/archive/` contienen referencias históricas a `FullTask`. NO se actualizan (son históricos).
- **grep FullTask post-commit**: `fiscal_agent/browser/task.py` define la class (1 ref) + `fiscal_agent/browser/__init__.py` exporta alias (1 ref) = las únicas 2 referencias remanentes permitidas.

**Recommendación**: Single PR. 189 líneas estimadas está muy por debajo del presupuesto de 400. No hay riesgo de overshoot.

---

## 2. Tasks

### Fase 1: BaseTask + ApiTask (aditivo, no rompe nada existente)

#### T-1: Crear `fiscal_agent/tasks/__init__.py` ✅

**Descripción**: Package init que exporta `BaseTask`, `ApiTask`, `PadronApiTask`, `PipelineStep`, `TaskResult`.

**Archivos**:
- `fiscal_agent/tasks/__init__.py` (CREAR, ~12 líneas)

**Dependencias**: Ninguna

**Esfuerzo**: ~12 líneas

**Detalle de implementación**:
```python
"""Task system — unified protocol for all operations (browser, API, SOAP)."""
from fiscal_agent.tasks.base import BaseTask, ApiTask, TaskResult, PipelineStep
from fiscal_agent.tasks.padron import PadronApiTask

__all__ = [
    "BaseTask", "ApiTask", "PadronApiTask",
    "PipelineStep", "TaskResult",
]
```

---

#### T-2: Crear `fiscal_agent/tasks/base.py` ✅

**Descripción**: Define `BaseTask` ABC, `ApiTask` ABC, `TaskResult` dataclass, y `PipelineStep` dispatcher.

**Archivos**:
- `fiscal_agent/tasks/base.py` (CREAR, ~75 líneas)

**Dependencias**: Ninguna (solo stdlib + typing)

**Esfuerzo**: ~75 líneas

**Detalle de implementación**:

```python
"""Base task protocol — unified interface for all system operations."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class TaskResult:
    """Compartido por BrowserTask y ApiTask."""
    task_name: str
    success: bool
    raw_output: str = ''
    parsed_data: dict = field(default_factory=dict)
    error: Optional[str] = None
    arca_error: Optional[str] = None    # solo BrowserTask
    task_id: Optional[str] = None       # solo BrowserTask


class BaseTask(ABC):
    """Protocolo unificado para toda task del sistema."""
    name: str = ''
    timeout: int = 300

    @abstractmethod
    def execute(self, context: dict) -> TaskResult:
        """Ejecuta la operación. Llamada bloqueante."""
        ...

    def parse_output(self, raw: Any) -> dict:
        """Parseo default: identidad."""
        return raw if isinstance(raw, dict) else {'_raw': str(raw)}


class ApiTask(BaseTask):
    """Task síncrona sin Composio (SOAP/REST directo)."""
    needs_ta: bool = False
    needs_certs: bool = False
    # execute() es abstractmethod heredado — se implementa en subclases


class PipelineStep:
    """Dispatcher liviano: BrowserTask → Composio, ApiTask → directo."""

    def run(self, tasks: list[BaseTask], context: dict) -> list[TaskResult]:
        """Despacha cada task según su tipo."""
        results: list[TaskResult] = []
        for task in tasks:
            if isinstance(task, ApiTask):
                # ApiTask: no usa browser, ejecuta directo
                from fiscal_agent.browser.task import BrowserTask
                if isinstance(task, BrowserTask):
                    # BrowserTask es también ApiTask? No. Pero por seguridad
                    # chequeamos BrowserTask primero abajo.
                    pass
                result = task.execute(context)
                results.append(result)
            elif isinstance(task, BaseTask):
                # BrowserTask u otra BaseTask concreta
                # Por ahora solo BrowserTask usa este branch vía ComposioBrowser
                from fiscal_agent.browser.task import BrowserTask
                if isinstance(task, BrowserTask):
                    # El dispatcher real delega al caller (ComposioBrowser)
                    # ya que la ejecución async requiere el browser instance.
                    # Este branch es para que PipelineStep pueda orquestar
                    # desde un contexto que ya tiene el browser.
                    raise NotImplementedError(
                        "BrowserTask dispatch via PipelineStep requires ComposioBrowser"
                    )
                raise ValueError(f'Unknown task type: {type(task).__name__}')
            else:
                raise ValueError(f'Unknown task type: {type(task).__name__}')
        return results
```

> **Nota de diseño**: `PipelineStep` delega BrowserTask al caller existente (`ComposioBrowser._run_single`). No reimplementa el dispatch async. La implementación actual del pipeline sigue usando `ComposioBrowser._run_single` directamente; `PipelineStep` es un wrapper para uso futuro cuando haya mix de tasks.

---

#### T-3: Crear `fiscal_agent/tasks/padron.py` ✅

**Descripción**: `PadronApiTask(ApiTask)` wrapping `consultar_cuit()` de `arca_ws.py`.

**Archivos**:
- `fiscal_agent/tasks/padron.py` (CREAR, ~50 líneas)

**Dependencias**: T-2 (necesita `ApiTask`, `TaskResult`)

**Esfuerzo**: ~50 líneas

**Detalle de implementación**:

```python
"""PadronApiTask — consulta al Padrón A5 vía SOAP como ApiTask."""

from __future__ import annotations

from fiscal_agent.arca_ws import consultar_cuit
from fiscal_agent.tasks.base import ApiTask, TaskResult


class PadronApiTask(ApiTask):
    """Wrapping de consultar_cuit() del WS ARCA A5."""
    name = 'padron_a5'
    needs_ta = True
    needs_certs = True
    timeout = 60

    def __init__(self, cuit: str) -> None:
        self._cuit = cuit

    def execute(self, context: dict) -> TaskResult:
        token = context['token']
        sign = context['sign']
        representante_cuit = context['representante_cuit']
        result = consultar_cuit(self._cuit, token, sign, representante_cuit)
        output = result.to_output()
        if output.errorConstancia:
            return TaskResult(
                task_name=self.name, success=False,
                parsed_data=result.to_dict(),
                error='; '.join(output.errorConstancia.error),
            )
        return TaskResult(
            task_name=self.name, success=True,
            parsed_data=result.to_dict(),
        )
```

---

### Fase 2: Rebase BrowserTask (cambio de herencia)

#### T-4: Modificar `fiscal_agent/browser/task.py` — Rebase + Rename ✅

**Descripción**: Tres cambios en un solo archivo: (1) importar `BaseTask` de `tasks.base`, (2) cambiar `BrowserTask(ABC)` → `BrowserTask(BaseTask)`, (3) renombrar `FullTask` → `VencimientosDeudasTask`. Mover `TaskResult` a `tasks/base.py` e importarlo desde allí.

**Archivos**:
- `fiscal_agent/browser/task.py` (MODIFICAR, ~30 líneas modificadas)

**Dependencias**: T-2 (necesita `BaseTask` y `TaskResult` existentes)

**Esfuerzo**: ~30 líneas

**Cambios concretos**:

| Línea | Cambio |
|-------|--------|
| 12 | `from abc import ABC, abstractmethod` → `from abc import abstractmethod` |
| 13 | `from dataclasses import dataclass, field` → `from dataclasses import field` |
| + | `from fiscal_agent.tasks.base import BaseTask, TaskResult` (nueva línea) |
| 139-153 | Eliminar `@dataclass class TaskResult` (migrado a `tasks/base.py`) |
| 159 | `class BrowserTask(ABC):` → `class BrowserTask(BaseTask):` |
| 181 | `class FullTask(BrowserTask):` → `class VencimientosDeudasTask(BrowserTask):` |
| 182-185 | Actualizar docstring: "Full pipeline" → "Vencimientos + deudas combinado" |

> **Riesgo**: `template_params: dict = field(default_factory=dict)` en `BrowserTask` no es un dataclass, pero funciona por override en `__init__`. No cambiar este comportamiento.

---

### Fase 3: Rename FullTask → VencimientosDeudasTask (archivos cliente)

#### T-5: Actualizar `fiscal_agent/browser/__init__.py` ✅

**Descripción**: Exportar `VencimientosDeudasTask` y mantener `FullTask` como alias backward-compatible.

**Archivos**:
- `fiscal_agent/browser/__init__.py` (MODIFICAR, ~6 líneas)

**Dependencias**: T-4 (necesita `VencimientosDeudasTask` definido)

**Esfuerzo**: ~6 líneas

**Cambios concretos**:

```python
from fiscal_agent.browser.task import (
    BrowserTask, FacilidadesTask, FullTask, IIBBTask, LoginTask, RegistroTask,
    VencimientosDeudasTask,
)

__all__ = [
    'ComposioBrowser',
    'BrowserTask',
    'FacilidadesTask',
    'FullTask',                # alias backward-compatible
    'IIBBTask',
    'LoginTask',
    'RegistroTask',
    'VencimientosDeudasTask',
]
```

O manteniendo el alias en el import:
```python
from fiscal_agent.browser.task import VencimientosDeudasTask as FullTask
```

---

#### T-6: Actualizar `fiscal_agent/browser/composio.py` ✅

**Descripción**: Cambiar import de `FullTask` a `VencimientosDeudasTask` en import y en default de `_run_single`.

**Archivos**:
- `fiscal_agent/browser/composio.py` (MODIFICAR, ~4 líneas)

**Dependencias**: T-4 (importa directamente de `fiscal_agent.browser.task`)

**Esfuerzo**: ~4 líneas

**Cambios concretos**:
- Línea 51: `FullTask,` → `VencimientosDeudasTask,`
- Línea 368: `FullTask(` → `VencimientosDeudasTask(`
- Líneas 352, 359: actualizar docstrings que mencionan `FullTask`

---

#### T-7: Actualizar `fiscal_agent/cli.py` ✅

**Descripción**: Cambiar import y uso de `FullTask` a `VencimientosDeudasTask`.

**Archivos**:
- `fiscal_agent/cli.py` (MODIFICAR, ~2 líneas)

**Dependencias**: T-5 (importa de `fiscal_agent.browser`, el `__init__.py`)

**Esfuerzo**: ~2 líneas

**Cambios concretos**:
- Línea 211: `FullTask,` → `VencimientosDeudasTask,`
- Línea 216: `FullTask(` → `VencimientosDeudasTask(`

---

#### T-8: Actualizar `fiscal_agent/api/routes/extract.py` ✅

**Descripción**: Cambiar import y mapping de `FullTask` a `VencimientosDeudasTask`.

**Archivos**:
- `fiscal_agent/api/routes/extract.py` (MODIFICAR, ~2 líneas)

**Dependencias**: T-5

**Esfuerzo**: ~2 líneas

**Cambios concretos**:
- Línea 70: `FullTask,` → `VencimientosDeudasTask,`
- Línea 81: `'deuda': FullTask,` → `'deuda': VencimientosDeudasTask,`

---

#### T-9: Actualizar `fiscal_agent/mcp/tools/deuda.py` ✅

**Descripción**: Cambiar import y uso de `FullTask` a `VencimientosDeudasTask`.

**Archivos**:
- `fiscal_agent/mcp/tools/deuda.py` (MODIFICAR, ~2 líneas)

**Dependencias**: T-5

**Esfuerzo**: ~2 líneas

**Cambios concretos**:
- Línea 13: `from fiscal_agent.browser import FullTask` → `from fiscal_agent.browser import VencimientosDeudasTask`
- Línea 50: `task = FullTask(` → `task = VencimientosDeudasTask(`

---

#### T-10: Actualizar `fiscal_agent/mcp/tools/report.py` ✅

**Descripción**: Cambiar import y uso de `FullTask` a `VencimientosDeudasTask`.

**Archivos**:
- `fiscal_agent/mcp/tools/report.py` (MODIFICAR, ~2 líneas)

**Dependencias**: T-5

**Esfuerzo**: ~2 líneas

**Cambios concretos**:
- Línea 94: `from fiscal_agent.browser import FullTask` → `from fiscal_agent.browser import VencimientosDeudasTask`
- Línea 97: `task = FullTask(` → `task = VencimientosDeudasTask(`

---

## 3. Dependency Graph

```
Fase 1 (aditivo)
══════════════════════════════════════════════
T-1: tasks/__init__.py      T-2: tasks/base.py
  (sin dependencias)          (sin dependencias)
        │                          │
        └──────────┬───────────────┘
                   │
                   ▼
              T-3: tasks/padron.py
              (deps: T-2)

Fase 2 (rebase)
══════════════════════════════════════════════
              T-2: tasks/base.py
                   │
                   ▼
              T-4: browser/task.py
              (deps: T-2)
              ┌────┤
              │    │
              ▼    ▼
Fase 3     T-5    T-6
(rename)   (init) (composio)
              │
     ┌────┬───┼───┬────┐
     ▼    ▼   ▼   ▼    ▼
    T-7  T-8 T-9 T-10
   (cli) (api)(mcp)(mcp)
```

**Parallelizables**:
- T-1 + T-2: paralelo (nuevos archivos, sin dependencias cruzadas)
- T-3 + T-4: paralelo (ambos dependen de T-2, no entre sí)
- T-7 + T-8 + T-9 + T-10: paralelo (todos dependen de T-5, no entre sí)
- T-5 + T-6: paralelo (T-5 depende de T-4 via `__init__.py`, T-6 depende de T-4 via import directo desde `task.py`)

## 4. Delivery Strategy Recommendation

### Veredicto: SINGLE PR ✅

| Factor | Valor |
|--------|-------|
| `delivery_strategy` config | `single-pr-default` |
| Review budget | 400 líneas |
| Estimación total | ~189 líneas (47% del presupuesto) |
| **Riesgo de overshoot** | **Ninguno** — incluso con 50% de margen, ~284 líneas |

### Chained PR evaluation

Se evaluaron 3 slices potenciales:

| Slice | Tareas | Líneas | Justificación |
|-------|--------|--------|---------------|
| PR-1: Fase 1 | T-1, T-2, T-3 | ~137 | Aditivo, no rompe nada. Se puede mergear solo. |
| PR-2: Fase 2+3 | T-4, T-5, T-6, T-7, T-8, T-9, T-10 | ~52 | Rebase + rename. Depende de PR-1. |

**Decisión**: Single PR. No hay razón para dividir:
1. 189 líneas está muy por debajo de 400.
2. Las fases 2 y 3 son triviales (grep-replace en 6 archivos, una línea cada uno).
3. El rebase `ABC` → `BaseTask` en `BrowserTask` es un cambio de una línea.
4. El costo cognitivo de coordinar 2 PRs para ~189 líneas totales no se justifica.

### Orden de implementación sugerido

```
1. T-1, T-2         ← paralelo (nuevos archivos)
2. T-3, T-4         ← paralelo (ambos dependen de T-2)
3. T-5, T-6         ← paralelo (ambos dependen de T-4)
4. T-7, T-8, T-9, T-10 ← paralelo entre sí (todos dependen de T-5)
```

### Verification post-commit

```bash
# 1. Rename completo: solo alias + class def
rg "FullTask" fiscal_agent/ --include '*.py'
# → fiscal_agent/browser/__init__.py (alias)
# → fiscal_agent/browser/task.py (class definition, docstring)

# 2. Rebase verificado
python -c "
from fiscal_agent.browser.task import BrowserTask, VencimientosDeudasTask
from fiscal_agent.tasks.base import BaseTask, ApiTask, TaskResult
assert issubclass(BrowserTask, BaseTask)
assert isinstance(VencimientosDeudasTask(), BaseTask)
assert hasattr(ApiTask, 'needs_ta')
assert hasattr(TaskResult, 'task_id')
print('✓ All checks passed')
"

# 3. Backward compat alias
python -c "
from fiscal_agent.browser import FullTask
from fiscal_agent.browser.task import VencimientosDeudasTask
assert FullTask is VencimientosDeudasTask
print('✓ Backward compat OK')
"
```
