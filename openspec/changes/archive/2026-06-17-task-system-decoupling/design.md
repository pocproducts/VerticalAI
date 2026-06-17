# Design: Task System Decoupling

## Technical Approach

Extraer un protocolo abstracto `BaseTask` del actual `BrowserTask(ABC)`, crear `ApiTask(BaseTask)` para tareas síncronas (SOAP/REST sin Composio), implementar `PadronApiTask` wrappeando `consultar_cuit()`, y proveer `PipelineStep` como dispatcher liviano que unifica ambas jerarquías. `BrowserTask` cambia su clase base de `ABC` a `BaseTask` sin alterar su mecanismo de ejecución. `FullTask` se renombra a `VencimientosDeudasTask` con alias backward-compatible.

## Architecture Decisions

### Decision: Ubicación de TaskResult

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Moverlo a `fiscal_agent/tasks/base.py` | Única definición, compartido por ambas jerarquías. Browser `__init__.py` re-exporta para backward compat | **Elegido** |
| Duplicarlo en browser/task.py y tasks/base.py | Evita imports cruzados, pero viola DRY | Descartado |
| Mantenerlo solo en browser/task.py | ApiTask tendría que importar desde browser, acoplamiento inverso | Descartado |

### Decision: PipelineStep como dispatcher liviano

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `isinstance` check | Simple, sin registro explícito. BrowserTask → Composio, ApiTask → thread pool directo | **Elegido** |
| Registry pattern con dict de handlers | Más extensible pero sobreingeniería para 2 tipos | Descartado |
| Visitor pattern | Máxima flexibilidad, complejidad innecesaria | Descartado |

### Decision: PadronApiTask wrappea, no duplica

`PadronApiTask.execute()` llama a `consultar_cuit()` existente. No replica lógica SOAP/XML. El `PadronA5Output` Pydantic model se serializa dentro de `TaskResult.parsed_data`.

### Decision: BrowserTask no cambia mecanismo

`BrowserTask(BaseTask)` mantiene `template`, `template_params`, `secrets`, `start_url`, `needs_auth`. Solo cambia herencia: `BaseTask` en vez de `ABC`. Su `execute()` sigue ejecutándose vía ComposioBrowser. ApiTask no toca el browser.

## Data Flow

```
PipelineStep.run(tasks=[BrowserTask, ApiTask], context)
        │
        ├── isinstance(task, BrowserTask)
        │       └── ComposioBrowser._run_single(cliente, tasks=[BrowserTask])
        │               └── Composio API (CreateTask → WatchTask → StopTask)
        │               └── TaskResult(task_name, success, raw_output, parsed_data, arca_error, task_id)
        │
        └── isinstance(task, ApiTask)
                └── task.execute(context)
                        └── consultar_cuit(cuit, token, sign, representante)
                                └── SOAP → PadronA5Result → PadronA5Output
                        └── TaskResult(task_name, success, raw_output='', parsed_data={PadronA5Output}, error=None)
```

## Class Diagram

```
fiscal_agent/tasks/base.py:
┌──────────────────────────────────────────────────┐
│  BaseTask(ABC)                                   │
│  ├── name: str                                   │
│  ├── timeout: int = 300                          │
│  ├── @abstractmethod execute(context: dict) → TR │
│  └── parse_output(raw: Any) → dict               │
└──────────────────────────────────────────────────┘
        ▲                          ▲
        │                          │
┌───────┴────────────────┐  ┌─────┴──────────────────────┐
│  ApiTask(BaseTask)     │  │  BrowserTask(BaseTask)      │
│  ├── needs_ta: bool    │  │  ├── template: str          │
│  ├── needs_certs: bool │  │  ├── template_params: dict  │
│  └── execute() → TR    │  │  ├── secrets: dict│None     │
└────────────────────────┘  │  ├── start_url: str│None    │
        ▲                   │  ├── needs_auth: bool       │
        │                   │  └── execute() → TR         │
┌───────┴──────────┐        └───────────┬────────────────┘
│ PadronApiTask    │              ┌──────┴──────────┐
│ name='padron_a5' │              │ Vencimientos    │
│ needs_ta=True    │              │ DeudasTask      │
│ needs_certs=True │              │ (ex FullTask)   │
│ execute():       │              │ name='full'     │
│  consultar_cuit()│              └─────────────────┘
└──────────────────┘

┌──────────────────────────────────────────────┐
│  PipelineStep                                │
│  ├── run(tasks, context) → list[TaskResult]  │
│  └── _run_browser(tasks, context) → list[TR] │
│      _run_api(task, context) → TaskResult     │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  @dataclass TaskResult                       │
│  ├── task_name: str                          │
│  ├── success: bool                           │
│  ├── raw_output: str = ''                    │
│  ├── parsed_data: dict = {}                  │
│  ├── error: Optional[str] = None             │
│  ├── arca_error: Optional[str] = None        │  ← solo BrowserTask
│  └── task_id: Optional[str] = None           │  ← solo BrowserTask
└──────────────────────────────────────────────┘
```

## File Changes

| File | Acción | Descripción |
|------|--------|-------------|
| `fiscal_agent/tasks/__init__.py` | Crear | Exports: `BaseTask`, `ApiTask`, `PadronApiTask`, `PipelineStep`, `TaskResult` |
| `fiscal_agent/tasks/base.py` | Crear | `BaseTask` ABC, `ApiTask` ABC, `TaskResult` dataclass, `PipelineStep` dispatcher |
| `fiscal_agent/tasks/padron.py` | Crear | `PadronApiTask(ApiTask)` wrapping `consultar_cuit()` |
| `fiscal_agent/browser/task.py` | Modificar | Rename `FullTask` → `VencimientosDeudasTask`; rebase `BrowserTask(ABC)` → `BrowserTask(BaseTask)`; import `TaskResult` de `tasks.base`; import `BaseTask` de `tasks.base` |
| `fiscal_agent/browser/__init__.py` | Modificar | Agregar `VencimientosDeudasTask`; mantener `FullTask` como alias |
| `fiscal_agent/browser/composio.py` | Modificar | `from fiscal_agent.browser.task import FullTask` → `import VencimientosDeudasTask` (o el nuevo nombre) |
| `fiscal_agent/cli.py` | Modificar | `FullTask` → `VencimientosDeudasTask` en import y uso |
| `fiscal_agent/api/routes/extract.py` | Modificar | `FullTask` → `VencimientosDeudasTask` en mapping |
| `fiscal_agent/mcp/tools/deuda.py` | Modificar | `FullTask` → `VencimientosDeudasTask` en import |
| `fiscal_agent/mcp/tools/report.py` | Modificar | `FullTask` → `VencimientosDeudasTask` en import |

## Interfaces / Contracts

```python
# fiscal_agent/tasks/base.py

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
```

```python
# fiscal_agent/tasks/padron.py

class PadronApiTask(ApiTask):
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

```python
# PipelineStep — dispatcher liviano

class PipelineStep:
    def run(self, tasks: list[BaseTask], context: dict) -> list[TaskResult]:
        results: list[TaskResult] = []
        for task in tasks:
            if isinstance(task, BrowserTask):
                # delega a ComposioBrowser
                ...
            elif isinstance(task, ApiTask):
                result = task.execute(context)
                results.append(result)
            else:
                raise ValueError(f'Unknown task type: {type(task).__name__}')
        return results
```

## Sequence: PipelineStep dispatches BrowserTask + ApiTask

```
PipelineStep                     ComposioBrowser               ApiTask.execute()
    │                                  │                            │
    ├── run([BrowserTask, ApiTask], ctx)                            │
    │   │                                                           │
    │   ├── isinstance(BrowserTask) → True                          │
    │   │   └── ComposioBrowser._run_single(cliente, [task])        │
    │   │       ├── CreateTask ────────────────────► Composio API   │
    │   │       ├── WatchTask ────────────────────► Composio API   │
    │   │       ├── _parse_arca_error(output)                       │
    │   │       └── TaskResult(arca_error, task_id)                 │
    │   │                                                           │
    │   ├── isinstance(ApiTask) → True                              │
    │   │   └── PadronApiTask.execute(ctx) ────────► ApiTask        │
    │   │       ├── consultar_cuit(cuit, token, sign, rep)          │
    │   │       ├── PadronA5Result → to_dict()                     │
    │   │       └── TaskResult(success, parsed_data)                │
    │   │                                                           │
    │   └── return [TaskResult(browser), TaskResult(api)]           │
    │                                  │                            │
```

## Backward Compatibility

| Aspecto | Estrategia |
|---------|------------|
| `FullTask` name | Alias en `fiscal_agent/browser/__init__.py`: `from fiscal_agent.browser.task import VencimientosDeudasTask as FullTask` |
| `TaskResult` location | Re-export desde `fiscal_agent/browser/task.py`: `from fiscal_agent.tasks.base import TaskResult` — todos los imports existentes siguen funcionando |
| `browser/task.py` imports | `from fiscal_agent.tasks.base import BaseTask, TaskResult` — browser no importa desde tasks/padron.py |
| `BrowserTask` constructor | Sin cambios: `__init__(cuit, clave, cliente_cuit)` igual |
| `BaseTask` new field `timeout` | BrowserTask ya tenía `timeout: int = 600` — coincide con la interfaz |
| API callers (`cli.py`, `routes/extract.py`, MCP tools) | Solo cambio de nombre `FullTask` → `VencimientosDeudasTask` |

## Verification

| Componente | Método | Criterio |
|------------|--------|----------|
| BaseTask ABC | `isinstance(BaseTask, ABC)` + métodos abstractos | `execute()` es abstracto; `name` y `timeout` son class vars |
| ApiTask BaseTask | `isinstance(ApiTask, BaseTask)` | ApiTask hereda de BaseTask |
| PadronApiTask execute() | Unit test con mock de `consultar_cuit()` | Retorna `TaskResult` con `parsed_data` = dict de PadronA5 |
| PadronApiTask error | Mock que retorna errorConstancia | `success=False`, `error` contiene mensaje |
| BrowserTask(BaseTask) | `isinstance(BrowserTask(), BaseTask)` | True |
| VencimientosDeudasTask output | `parse_output(raw)` con fixture existente | Misma estructura que `_parse_extract_output()` |
| PipelineStep dispatch | `PipelineStep().run([BrowserTask(), PadronApiTask(...)], ctx)` | Retorna 2 TaskResults, tipos correctos |
| PipelineStep unknown | `PipelineStep().run([object()], {})` | Lanza `ValueError` |
| FullTask alias | `from fiscal_agent.browser import FullTask` | `FullTask is VencimientosDeudasTask` |
| grep FullTask | `rg "FullTask" fiscal_agent/ --include '*.py'` | Solo en `browser/__init__.py` (alias) y `browser/task.py` (definición class) |

## Open Questions

None — todos los puntos están resueltos en specs y código existente.
