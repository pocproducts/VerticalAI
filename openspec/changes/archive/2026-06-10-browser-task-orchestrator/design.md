# Design: Browser Task Orchestrator

## Technical Approach

Extraer el pipeline de navegación de `_run_single()` en una jerarquía `BrowserTask` donde cada tarea es una unidad atómica Composio (CREATE → WATCH → parse). El orquestador itera `list[BrowserTask]` reusando `session_id` y ejecuta STOP_TASK una única vez al final. `FullTask` envuelve `TEMPLATE_FULL` completo como una sola tarea para backward compatibility.

Referencia: specs `browser-task` REQ-1–4 y `composio-browser-integration` REQ-6.

## Architecture Decisions

### ABC vs Protocol vs Callable

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| `Protocol` (duck typing) | Sin herencia de estado; cada tarea repite `template`, `secrets`, `start_url` | ❌ |
| `Callable` (función) | No hay estado compartido; parseo atado a firma, no a datos | ❌ |
| `ABC` con campos y `parse_output()` | Una sola jerarquía, estado por field, herencia de defaults (`needs_auth=True`, `timeout=120`) | ✅ |

**Rationale**: ABC permite campos con default + método abstracto `parse_output()`. Las subclases (`FullTask`, `LoginTask`) declaran template y parsing, el orquestador solo itera y llama `execute()`.

### `parse_output()` como método vs función externa

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Función externa + switch | El orquestador necesita conocer el tipo para elegir parser | ❌ |
| Método en `BrowserTask` | Cada tarea conoce su propio formato de output; polimorfismo natural | ✅ |

**Rationale**: `FullTask.parse_output()` llama `_parse_extract_output()`, `LoginTask.parse_output()` llama `_parse_arca_error()`. El orquestador no necesita saber qué parser usar.

### Timeout por task vs global

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Global 300s | Tasks cortas (login) bloquean el pool si falla WATCH lento | ❌ |
| Por task (default 120s) | Cada tarea define su duración esperada; login <30s, extract <120s | ✅ |

**Rationale**: Cada `BrowserTask.timeout` se pasa a `_watch_task()`. Login expira rápido, extract tolera más latencia. `FullTask` hereda default 120s.

### STOP_TASK al final vs por task

| Opción | Tradeoff | Decisión |
|--------|----------|----------|
| Por task | STOP_TASK mata la sesión Composio → tasks siguientes pierden cookies/session | ❌ |
| Al final | Una sola llamada STOP_TASK al terminar todas las tasks de la sesión | ✅ |

**Rationale**: Composio `STOP_TASK` destruye el browser context. Si se ejecuta después de login, la task de extract ya no tiene sesión. Se ejecuta una vez en `finally` del loop multi-task.

## Data Flow

### Flujo actual (1 task FullTask)

```
ComposioBrowser._run_single(cliente)
  │
  ├─ CREATE_TASK(TEMPLATE_FULL, secrets=estudio, start_url=auth.afip...)
  │     → task_id, session_id
  ├─ [headed] GET_SESSION(session_id) → liveUrl
  ├─ WATCH_TASK(task_id, timeout=300)
  │     → output (JSON de vencimientos + deudas)
  ├─ _parse_arca_error(output) → None
  ├─ _parse_extract_output(output) → {vencimientos, deudas}
  └─ finally: STOP_TASK(task_id)
       → DeudaOutput(cuit, vencimientos, deudas, ...)
```

### Flujo nuevo multi-task (login + extractV2)

```
ComposioBrowser._run_single(cliente, tasks=[LoginTask, ExtractV2Task])
  │
  ├─ LoginTask ────────────────────────────────────────────────
  │   ├─ CREATE_TASK(TEMPLATE_LOGIN, secrets=estudio, start_url)
  │   │     → task_id, session_id
  │   ├─ WATCH_TASK(task_id, timeout=30)
  │   │     → output (login result)
  │   ├─ parse_output(output) → ARCA-4/ARCA-6 detection
  │   └─ TaskResult(success=True, task_id="...", parsed_data={})
  │
  │  ← session_id reusado ───────────────────────
  │
  ├─ ExtractV2Task (needs_auth=False) ──────────────────────────
  │   ├─ CREATE_TASK(TEMPLATE_EXTRACT_V2, session_id=session_id)
  │   │     → task_id
  │   ├─ WATCH_TASK(task_id, timeout=120)
  │   │     → output (JSON vencimientos + deudas)
  │   ├─ parse_output(output) → {vencimientos, deudas}
  │   └─ TaskResult(success=True, parsed_data={vencimientos: [...], deudas: [...]})
  │
  └─ finally: STOP_TASK(task_id)
       → Consolidar TaskResults → DeudaOutput
```

### Falla en task intermedia

```
LoginTask → ✅ TaskResult(success=True)
ExtractV2Task → ❌ TaskResult(success=False, error="...")
  └→ Pipeline detenido — ExtractV3Task NO se ejecuta
  └→ finally: STOP_TASK (mata la última task activa)
  └→ DeudaOutput(cuit, error="...", vencimientos=[], deudas=[])
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/browser/task.py` | Create | `TaskResult` dataclass, `BrowserTask` ABC, `FullTask`, `LoginTask`, `ExtractV2Task` |
| `fiscal_agent/browser/composio.py` | Modify | `_run_single()` acepta `tasks: Optional[list[BrowserTask]]`, loop multi-task con session reuse, STOP_TASK al final |
| `fiscal_agent/browser/__init__.py` | Modify | Export `BrowserTask`, `FullTask`, `LoginTask` |
| `fiscal_agent/browser/workflows/__init__.py` | No change | Templates ya se importan desde sus módulos |

## Interfaces / Contracts

```python
# fiscal_agent/browser/task.py

@dataclass
class TaskResult:
    task_name: str
    success: bool
    raw_output: str = ''
    parsed_data: dict = field(default_factory=dict)
    arca_error: Optional[str] = None
    task_id: Optional[str] = None
    error: Optional[str] = None


class BrowserTask(ABC):
    name: str
    template: str
    template_params: dict
    secrets: Optional[dict] = None
    start_url: Optional[str] = None
    needs_auth: bool = True
    timeout: int = 120

    @abstractmethod
    def parse_output(self, raw: str) -> dict: ...


class FullTask(BrowserTask):
    name = 'full'
    template = TEMPLATE_FULL
    # template_params set at __init__ via .format()
    needs_auth = True

    def parse_output(self, raw: str) -> dict:
        return _parse_extract_output(raw)  # reuse existing logic


class LoginTask(BrowserTask):
    name = 'login'
    template = TEMPLATE_LOGIN
    needs_auth = True
    timeout = 30
    start_url = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'

    def parse_output(self, raw: str) -> dict:
        error = _parse_arca_error(raw)
        if error:
            return {'arca_error': error}
        return {}


class ExtractV2Task(BrowserTask):
    name = 'extract_v2'
    template = TEMPLATE_FULL  # same NL template, different orchestration
    needs_auth = False
    timeout = 120

    def parse_output(self, raw: str) -> dict:
        return _parse_extract_output(raw)
```

### `_run_single()` refactor

```python
async def _run_single(
    self,
    cliente: ClientConfig,
    tasks: Optional[list[BrowserTask]] = None,
) -> DeudaOutput:
    if tasks is None:
        tasks = [FullTask(
            cuit=self._estudio_cuit,
            clave=self._estudio_clave,
            cliente_cuit=cliente.cuit,
        )]

    session_id: Optional[str] = None
    last_task_id: Optional[str] = None
    results: list[TaskResult] = []

    try:
        for task in tasks:
            params = task.template.format(**task.template_params)
            secrets = task.secrets or (self._default_secrets() if task.needs_auth else None)

            create_result = await self._create_task(
                instruction=params,
                secrets=secrets,
                start_url=task.start_url,
                session_id=session_id if not task.needs_auth else None,
            )
            task_id = create_result.get('taskId') or create_result.get('id')
            last_task_id = task_id

            if session_id is None:
                session_id = create_result.get('sessionId') or create_result.get('browser_session_id')

            # Watch con timeout individual
            output = await self._watch_task(task_id, timeout=task.timeout)
            raw = str(output.get('output', output.get('data', '')))

            # Parse
            result = TaskResult(
                task_name=task.name,
                success=True,
                raw_output=raw,
                parsed_data=task.parse_output(raw),
                task_id=task_id,
            )

            # Detener pipeline si hay error ARCA
            arca_err = _parse_arca_error(raw)
            if arca_err:
                result.success = False
                result.arca_error = arca_err
                results.append(result)
                break

            # Detener si parse_output falló internamente
            if not result.parsed_data and raw:
                result.success = False
                result.error = 'No se pudo parsear output'

            results.append(result)

            # Si una task falló, no continuar
            if not result.success:
                break

        # Consolidar TaskResults → DeudaOutput
        return self._consolidate(cliente, results)

    except (asyncio.TimeoutError, ComposioError, Exception) as e:
        ...
    finally:
        if last_task_id:
            await self._stop_task(last_task_id)
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `TaskResult` dataclass | Crear instancia, verificar campos y defaults |
| Unit | `FullTask.parse_output()` | Inyectar JSON conocido, verificar `{vencimientos, deudas}` |
| Unit | `LoginTask.parse_output()` | Inyectar texto con ARCA-4/ARCA-6 patterns, verificar detección |
| Unit | Consolidation `TaskResults → DeudaOutput` | 1 task exitosa, 2 tasks, task fallida |
| Integration | `_run_single(tasks=[FullTask])` vs actual | Comparar `DeudaOutput` idéntico al actual (mock Composio API) |
| Integration | Session reuse entre tasks | Mock `_create_task` y verificar que `session_id` se pasa al segundo task |

## Migration / Rollout

No migration required. `tasks=None` default en `_run_single()` asegura que `run_single()` y `run_all()` existentes sigan funcionando sin cambios. El nuevo `tasks=` param es opt-in — los tasks específicos (`LoginTask`, `ExtractV2Task`) se pueden agregar en releases posteriores sin tocar el orquestador.

Rollback: revertir `composio.py`, borrar `task.py`. `_run_single()` vuelve a `TEMPLATE_FULL`.

## Open Questions

None. Diseño cubierto por specs `browser-task` y `composio-browser-integration` REQ-6.
