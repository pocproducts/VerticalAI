# Tasks: Browser Task Orchestrator

## Resumen

Refactorizar `ComposioBrowser._run_single()` para soportar múltiples `BrowserTask` por sesión Composio. Extraer `_parse_extract_output` y `_parse_arca_error` de static methods a funciones module-level en `task.py` (evitando circular imports). Jerarquía `BrowserTask(ABC)` en archivo nuevo. `_run_single()` itera tasks compartiendo `session_id`. STOP_TASK una vez al final.

**Contexto**: La firma actual `_run_single(cliente)` cambia a `_run_single(cliente, tasks=None)`. `tasks=None` → `[FullTask()]` por defecto. `run_single()` y `run_all()` sin cambios de firma.

---

### T-1: Crear `fiscal_agent/browser/task.py` — jerarquía BrowserTask + helpers de parseo

- **Archivos**: `fiscal_agent/browser/task.py` (NUEVO)
- **Dependencias**: Ninguna (no debe importar de `composio.py`)
- **Líneas estimadas**: ~170

#### Pasos

1. **Mover funciones de parseo** desde `ComposioBrowser` estáticos a module-level en `task.py`:
   - `_parse_arca_error(data: str) -> Optional[str]` — copiar cuerpo completo desde `composio.py` (L305–366). Misma lógica: detecta ARCA-4 y ARCA-6 por pattern matching case-insensitive.
   - `_parse_extract_output(data: str) -> dict[str, Any]` — copiar cuerpo completo desde `composio.py` (L370–417). Mismas 3 estrategias: JSON directo → desescape → brace-matching.
   - Ambas quedan como funciones `module-level` (NO static methods), con `_` prefijo indicando privadas. Importables desde `composio.py`.

2. **Crear `TaskResult` dataclass**:
   ```python
   @dataclass
   class TaskResult:
       task_name: str
       success: bool
       raw_output: str = ''
       parsed_data: dict = field(default_factory=dict)
       arca_error: Optional[str] = None
       task_id: Optional[str] = None
       error: Optional[str] = None
   ```
   - `task_name`: str — identificador de la tarea que se ejecutó
   - `success`: bool — True si completó sin errores de parseo ni ARCA
   - `raw_output`: str — output crudo del AI agent (WatchTask response)
   - `parsed_data`: dict — JSON parseado (vencimientos, deudas, etc.)
   - `arca_error`: Optional[str] — "ARCA-4" o "ARCA-6" si se detectó
   - `task_id`: Optional[str] — ID Composio de la task (debug/logging)
   - `error`: Optional[str] — mensaje de error si falló (timeout, API, etc.)

3. **Crear `BrowserTask(ABC)`** con los siguientes campos y método abstracto:
   ```python
   class BrowserTask(ABC):
       name: str = ''
       template: str = ''
       template_params: dict = field(default_factory=dict)
       secrets: Optional[dict] = None
       start_url: Optional[str] = None
       needs_auth: bool = True
       timeout: int = 120

       @abstractmethod
       def parse_output(self, raw: str) -> dict: ...
   ```
   - `name`: identificador para logging y TaskResult.task_name
   - `template`: string template NL con placeholders `{cuit}`, `{clave}`, `{cliente_cuit}`
   - `template_params`: dict para `template.format(**template_params)`
   - `secrets`: credenciales HTTP basic auth (`{'auth.afip.gob.ar': 'cuit:clave'}`)
   - `start_url`: URL inicial de navegación (login ARCA)
   - `needs_auth`: True si necesita sesión nueva con secrets. False para reusar session_id existente.
   - `timeout`: timeout individual para WATCH_TASK (default 120s)
   - `parse_output()`: cada subclase conoce su propio formato de output

4. **Crear `FullTask(BrowserTask)`** — tarea combinada login+switch+extract:
   - `name = 'full'`
   - `template = TEMPLATE_FULL` (importado de `workflows`)
   - `needs_auth = True`
   - `timeout = 120`
   - `__init__(self, cuit: str, clave: str, cliente_cuit: str)`:
     - Setea `template_params = {'cuit': cuit, 'clave': clave, 'cliente_cuit': cliente_cuit}`
     - Setea `secrets = {'auth.afip.gob.ar': f'{cuit}:{clave}'}`
     - Setea `start_url = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'`
   - `parse_output(raw) -> dict`: llama `_parse_extract_output(raw)` (module-level)
   - Produce `{vencimientos: [...], deudas: [...]}` — idéntico al actual

5. **Crear `LoginTask(BrowserTask)`** — solo login ARCA:
   - `name = 'login'`
   - `template = TEMPLATE_LOGIN`
   - `needs_auth = True`
   - `timeout = 30` (login es rápido)
   - `start_url = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml'`
   - `__init__(self, cuit: str, clave: str)`:
     - `template_params = {'cuit': cuit, 'clave': clave}`
     - `secrets = {'auth.afip.gob.ar': f'{cuit}:{clave}'}`
   - `parse_output(raw) -> dict`: llama `_parse_arca_error(raw)`. Si hay error → `{'arca_error': error}`, si no → `{}`

6. **Crear `ExtractV2Task(BrowserTask)`** — solo extract, reusa sesión:
   - `name = 'extract_v2'`
   - `template = TEMPLATE_FULL` (mismo template NL, pero sin login porque reusa session_id)
   - `needs_auth = False` (NO crea sesión nueva, reusa session_id existente)
   - `timeout = 120`
   - `__init__(self, cuit: str, clave: str, cliente_cuit: str)`:
     - `template_params = {'cuit': cuit, 'clave': clave, 'cliente_cuit': cliente_cuit}`
     - NOTA: No setea `secrets` ni `start_url` (la sesión ya está autenticada)
   - `parse_output(raw) -> dict`: llama `_parse_extract_output(raw)`
   - Produce mismo formato que FullTask

#### Criterio de verificación

- [x] `TaskResult` se construye con todos los campos, defaults funcionan
- [x] `FullTask(cuit, clave, cliente_cuit)` tiene `template_params`, `secrets`, `start_url` no vacíos
- [x] `LoginTask(cuit, clave)` tiene `timeout=30`, `needs_auth=True`
- [x] `ExtractV2Task(cuit, clave, cliente_cuit)` tiene `needs_auth=False`, `secrets=None`
- [x] `_parse_extract_output('{"vencimientos":[],"deudas":[]}')` retorna dict con ambas keys
- [x] `_parse_arca_error('error ARCA-4')` retorna `'ARCA-4'`
- [x] `_parse_arca_error('todo OK')` retorna `None`
- [x] task.py NO importa nada de composio.py (sin circular imports)
- [x] `from fiscal_agent.browser.task import BrowserTask, FullTask, LoginTask, ExtractV2Task, TaskResult` funciona

---

### T-2: Refactor `_run_single()` multi-task en `composio.py`

- **Archivos**: `fiscal_agent/browser/composio.py`
- **Dependencias**: T-1 (task.py debe existir)
- **Líneas estimadas**: ~+100 netas (agrega loop multi-task, remueve static methods, agrega `_consolidate`)

#### Pasos

1. **Agregar imports** de `task.py` al inicio del archivo:
   ```python
   from fiscal_agent.browser.task import (
       BrowserTask,
       FullTask,
       TaskResult,
       _parse_arca_error,
       _parse_extract_output,
   )
   ```
   Remover el import `from fiscal_agent.models import ...` que ya está — solo agregar los nuevos.

2. **Extraer `_parse_arca_error` y `_parse_extract_output`** de la clase `ComposioBrowser`:
   - Eliminar ambos `@staticmethod` de la clase (líneas 305–417 aproximadamente)
   - En la clase, **NO dejar wrappers** — las funciones ahora viven en `task.py`
   - Buscar TODOS los call-sites dentro de `ComposioBrowser` que usen `self._parse_arca_error(...)` o `self._parse_extract_output(...)` y reemplazar con `_parse_arca_error(...)` y `_parse_extract_output(...)` directamente (son module-level imports ahora).

3. **Cambiar firma de `_run_single()`**:
   ```python
   async def _run_single(
       self,
       cliente: ClientConfig,
       tasks: Optional[list[BrowserTask]] = None,
   ) -> DeudaOutput:
   ```
   - `tasks=None` → por defecto crear `[FullTask(cuit=self._estudio_cuit, clave=self._estudio_clave, cliente_cuit=cliente.cuit)]`

4. **Implementar loop multi-task** dentro de `_run_single()` reemplazando el pipeline actual (L440–634):

   ```python
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
           # ── Preparar parámetros ──────────────────────────────────
           instruction = task.template.format(**task.template_params)
           secrets = task.secrets if task.needs_auth else None
           start_url = task.start_url if task.needs_auth else None

           # Si needs_auth=False → reusa session_id; si needs_auth=True → None (crea nueva)
           reuse_session = session_id if not task.needs_auth else None

           logger.info(
               'Ejecutando task=%s para %s (needs_auth=%s, reuse_session=%s)',
               task.name, cliente.cuit, task.needs_auth, bool(reuse_session),
           )

           # ── CREATE_TASK ───────────────────────────────────────────
           create_result = await self._create_task(
               instruction=instruction,
               secrets=secrets,
               start_url=start_url,
               session_id=reuse_session,
           )
           task_id = create_result.get('taskId') or create_result.get('id')
           last_task_id = task_id

           # Capturar session_id de la primera task
           if session_id is None:
               session_id = create_result.get('sessionId') or create_result.get('browser_session_id')

           if not task_id:
               raise ComposioError(f'No taskId en CreateTask para {task.name}')

           logger.info('Task %s creada: taskId=%s, sessionId=%s', task.name, task_id, session_id or 'N/A')

           # ── Headed mode (solo primera task con sesión nueva) ──────
           if self._headed and session_id and task.needs_auth:
               try:
                   session_info = await self._get_session(session_id)
                   live_url = session_info.get('liveUrl', '')
                   if live_url:
                       logger.warning('═══ LIVE BROWSER — abrí este link: %s ═══', live_url)
               except Exception as e:
                   logger.warning('No se pudo obtener URL de sesión: %s', e)

           # ── WATCH_TASK con timeout individual ───────────────────
           output = await self._watch_task(task_id, timeout=task.timeout)
           raw = str(output.get('output', output.get('data', '')))

           logger.info('Output crudo de %s (primeros 500): %s', task.name, raw[:500])

           # ── Parsear ──────────────────────────────────────────────
           parsed_data = task.parse_output(raw)

           # ── Detectar ARCA error ──────────────────────────────────
           arca_error = _parse_arca_error(raw)
           result = TaskResult(
               task_name=task.name,
               success=arca_error is None,
               raw_output=raw,
               parsed_data=parsed_data,
               arca_error=arca_error,
               task_id=task_id,
           )

           # Si parse_output no produjo datos pero hay raw → warning
           if not parsed_data and raw and not arca_error:
               logger.warning('Task %s: output no parseable', task.name)

           results.append(result)

           # ── Detener pipeline si falló ────────────────────────────
           if arca_error or not result.success:
               logger.error('Task %s falló para %s: %s', task.name, cliente.cuit, arca_error or result.error)
               break

       # ── Consolidar TaskResults → DeudaOutput ───────────────────
       return self._consolidate(cliente, results)

   except asyncio.TimeoutError:
       logger.error('Timeout en task para %s', cliente.cuit)
       return DeudaOutput(cuit=cliente.cuit, extraido_el=datetime.now(), error='Timeout')
   except ComposioError as e:
       logger.error('Error Composio para %s: %s', cliente.cuit, e)
       return DeudaOutput(cuit=cliente.cuit, extraido_el=datetime.now(), error=str(e))
   except Exception as e:
       logger.error('Error inesperado para %s: %s', cliente.cuit, e)
       return DeudaOutput(cuit=cliente.cuit, extraido_el=datetime.now(), error=f'Error inesperado: {e}')
   finally:
       if last_task_id:
           await self._stop_task(last_task_id)
   ```

5. **Agregar método `_consolidate()`** a `ComposioBrowser` para convertir `list[TaskResult]` en `DeudaOutput`:
   ```python
   def _consolidate(self, cliente: ClientConfig, results: list[TaskResult]) -> DeudaOutput:
       """Consolida lista de TaskResults en un solo DeudaOutput.

       Toma el parsed_data de la ÚLTIMA task exitosa con datos.
       Si todas fallaron, retorna DeudaOutput con error.
       """
       if not results:
           return DeudaOutput(
               cuit=cliente.cuit,
               extraido_el=datetime.now(),
               error='No se ejecutaron tasks',
           )

       # Buscar la última task exitosa con parsed_data
       last_ok = None
       for r in reversed(results):
           if r.success and r.parsed_data:
               last_ok = r
               break

       if last_ok is None:
           # Ninguna task exitosa — tomar error de la última
           last_result = results[-1]
           return DeudaOutput(
               cuit=cliente.cuit,
               extraido_el=datetime.now(),
               error=last_result.arca_error or last_result.error or 'Error desconocido',
           )

       data = last_ok.parsed_data

       # Construir VencimientoDeuda[] desde parsed_data
       vencimientos_raw = data.get('vencimientos', [])
       vencimientos = []
       for item in vencimientos_raw:
           try:
               fv = item.get('fecha_vencimiento')
               vencimientos.append(VencimientoDeuda(
                   impuesto=item.get('impuesto', ''),
                   concepto=item.get('concepto', ''),
                   subconcepto=item.get('subconcepto', ''),
                   periodo=int(item.get('periodo', 0)),
                   anticuota=int(item.get('anticuota', 0)),
                   fecha_vencimiento=(
                       datetime.strptime(fv, '%Y-%m-%d').date()
                       if fv and isinstance(fv, str) and len(fv) >= 10 else None
                   ),
                   detalle=item.get('detalle', ''),
               ))
           except (ValueError, TypeError) as e:
               logger.warning('Vencimiento inválido omitido: %s — %s', item, e)

       # Construir DeudaDetail[] desde parsed_data
       deudas_raw = data.get('deudas', [])
       deudas = []
       for item in deudas_raw:
           try:
               fv = item.get('vencimiento')
               deudas.append(DeudaDetail(
                   impuesto=item.get('impuesto', ''),
                   concepto=item.get('concepto', ''),
                   subconcepto=item.get('subconcepto', ''),
                   periodo=int(item.get('periodo', 0)),
                   anticuota=int(item.get('anticuota', 0)),
                   vencimiento=(
                       datetime.strptime(fv, '%Y-%m-%d').date()
                       if fv and isinstance(fv, str) and len(fv) >= 10 else None
                   ),
                   saldo=float(item.get('saldo', 0)),
                   interes_resarcitorio=float(item.get('interes_resarcitorio', 0)),
                   interes_punitorio=float(item.get('interes_punitorio', 0)),
               ))
           except (ValueError, TypeError) as e:
               logger.warning('Deuda inválida omitida: %s — %s', item, e)

       # Legacy saldos
       saldos_raw = data.get('saldos', [])
       saldos = []
       for item in saldos_raw:
           try:
               saldos.append(DeudaItem(
                   concepto=item.get('concepto', ''),
                   importe=float(item.get('importe', 0)),
                   vencimiento=item.get('vencimiento'),
               ))
           except (ValueError, TypeError) as e:
               logger.warning('Saldo inválido omitido: %s — %s', item, e)

       deuda_actual = data.get('deuda_actual')
       plan_pagos = data.get('plan_pagos')

       return DeudaOutput(
           cuit=cliente.cuit,
           extraido_el=datetime.now(),
           vencimientos=vencimientos,
           deudas=deudas,
           deuda_actual=float(deuda_actual) if deuda_actual is not None else None,
           saldos=saldos,
           plan_pagos=plan_pagos,
           error=None,
       )
   ```

   Este método reemplaza las líneas 498–608 del `_run_single()` actual (construcción de `DeudaOutput`), extrayéndolo a un método reutilizable.

6. **Mantener `run_single()` y `run_all()` sin cambios de firma** — `run_single()` sigue llamando `self._run_single(cliente)`, que ahora usa `tasks=None` → `[FullTask()]`. `run_all()` sigue llamando `self._run_single(c)` para cada cliente.

#### Criterio de verificación

- [x] `_run_single(cliente)` sin `tasks` produce `DeudaOutput` idéntico al actual (misma estructura)
- [x] `_run_single(cliente, tasks=[FullTask(...)])` produce exactamente el mismo resultado que sin tasks
- [x] `_run_single(cliente, tasks=[LoginTask(...), ExtractV2Task(...)])` ejecuta ambas tareas secuencialmente
- [x] `session_id` se comparte: segunda task recibe session_id de la primera
- [x] `session_id` es `None` en primera task con `needs_auth=True` (crea sesión nueva)
- [x] STOP_TASK se ejecuta UNA VEZ al final del finally (no por task individual)
- [x] Si `LoginTask` falla con ARCA-4, `ExtractV2Task` NO se ejecuta
- [x] `_parse_arca_error` y `_parse_extract_output` se importan de task.py (no hay static methods duplicados)
- [x] No hay referencias a `self._parse_arca_error` ni `self._parse_extract_output` en composio.py
- [x] `run_single(cliente)` y `run_all(clientes)` mantienen firma exacta
- [x] Toda excepción capturada retorna `DeudaOutput` con error (nunca propaga)
- [x] Logging incluye `task.name` en cada operación para trazabilidad multi-task

---

### T-3: Actualizar `fiscal_agent/browser/__init__.py` — exports

- **Archivos**: `fiscal_agent/browser/__init__.py`
- **Dependencias**: T-1 (task.py debe existir)
- **Líneas estimadas**: ~5 cambiadas

#### Pasos

1. **Agregar imports** de las nuevas clases:
   ```python
   from fiscal_agent.browser.task import BrowserTask, FullTask, LoginTask
   ```

2. **Agregar a `__all__`**:
   ```python
   __all__ = ['ComposioBrowser', 'BrowserTask', 'FullTask', 'LoginTask']
   ```

   `ExtractV2Task` queda fuera de `__all__` por ahora (es uso interno, no parte de la API pública).

#### Criterio de verificación

- [x] `from fiscal_agent.browser import ComposioBrowser, BrowserTask, FullTask, LoginTask` funciona
- [x] `fiscal_agent.browser.__all__` contiene los 4 nombres
- [x] No se rompen imports existentes que usan `from fiscal_agent.browser import ComposioBrowser`

---

## Resumen de líneas estimadas

| Archivo | Acción | Líneas |
|---------|--------|--------|
| `fiscal_agent/browser/task.py` | Crear | ~170 |
| `fiscal_agent/browser/composio.py` | Modificar | ~+100 netas |
| `fiscal_agent/browser/__init__.py` | Modificar | ~5 |
| **Total** | | **~275** (dentro de 400) |

## Dependencias entre tareas

```
T-1 (task.py) ──→ T-2 (composio.py)
  └── sin dependencias de composio.py
  └── Importa TEMPLATE_FULL, TEMPLATE_LOGIN de workflows

T-1 (task.py) ──→ T-3 (__init__.py)
```

T-1 debe completarse primero. T-2 y T-3 pueden hacerse en paralelo después de T-1.

## Check-list post-implementación

- [x] `from fiscal_agent.browser import ComposioBrowser, BrowserTask, FullTask, LoginTask` — imports sin error
- [x] `from fiscal_agent.browser.task import _parse_arca_error, _parse_extract_output` — helpers accesibles
- [x] `hasattr(ComposioBrowser, '_parse_arca_error')` → `False` (static methods removidos)
- [x] `run_single()` produce `DeudaOutput` idéntico al actual (mismos campos, misma estructura)
- [x] Sin cambios en `models.py`, `cli.py`, `pdf_generator.py`
