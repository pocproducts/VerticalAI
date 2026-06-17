# browser-task Specification

> BrowserTask protocol — abstraction para operaciones de navegación atómicas en Composio Browser Tool. Cada BrowserTask es una unidad independiente que puede ejecutarse en una sesión Composio compartida.

## Purpose

Desacoplar la lógica de navegación (templates NL) del orquestador de sesiones Composio. Cada tarea de navegación (login, extraer deuda, descargar certificado, etc.) se define como un `BrowserTask` autónomo. El orquestador itera tasks compartiendo el mismo `session_id` de Composio, evitando relogueos y permitiendo agregar nuevas tareas sin tocar el orquestador.

## Requirements

### REQ-1: BrowserTask Protocol

`BrowserTask(BaseTask)` SHALL ser una subclase concreta de `BaseTask` que define la interfaz para operaciones de navegación atómicas en Composio. BrowserTask hereda `name`, `timeout`, `parse_output()` y `execute()` de `BaseTask`.

MUST exponer (además de lo heredado de BaseTask):
- `template: str` — template NL con placeholders
- `template_params: dict` — parámetros para `template.format()`
- `secrets: Optional[dict]` — credenciales HTTP básicas para la sesión
- `start_url: Optional[str]` — URL inicial de navegación
- `needs_auth: bool` — True si requiere login previo (crea sesión nueva)

#### Scenario: BrowserTask completo

- GIVEN un BrowserTask con template, params y secrets
- WHEN se construye
- THEN tiene `name` y `template` no vacíos
- THEN `timeout` tiene valor por defecto 300
- THEN `needs_auth` es True por defecto

#### Scenario: BrowserTask como BaseTask

- GIVEN un BrowserTask
- WHEN se construye
- THEN hereda `name` y `timeout` de BaseTask
- THEN implementa `parse_output()` y `execute()`
- THEN `isinstance(task, BaseTask)` es True

### REQ-2: TaskResult

`TaskResult` SHALL ser un dataclass que captura el resultado de UNA ejecución de cualquier `BaseTask` (BrowserTask o ApiTask).

MUST contener:
- `task_name: str` — nombre de la tarea
- `success: bool` — True si completó sin errores
- `raw_output: str` — output crudo del AI agent
- `parsed_data: dict` — JSON parseado
- `error: Optional[str]` — cualquier otro error
- `arca_error: Optional[str]` — error ARCA-4/ARCA-6 si ocurrió (solo BrowserTask)
- `task_id: Optional[str]` — ID de la task Composio (solo BrowserTask)

#### Scenario: Task exitosa

- GIVEN un BrowserTask que completa OK
- WHEN `execute()` retorna
- THEN `success` es True
- THEN `parsed_data` contiene el JSON extraído
- THEN `task_id` no es None
- THEN `arca_error` es None

#### Scenario: Task con error ARCA

- GIVEN un login con credenciales inválidas
- WHEN el AI agent detecta ARCA-4
- THEN `success` es False
- THEN `arca_error` es "ARCA-4"
- THEN `parsed_data` es dict vacío

#### Scenario: TaskResult desde ApiTask

- GIVEN una ejecución de ApiTask exitosa
- WHEN retorna TaskResult
- THEN `success` es True
- THEN `task_id` y `arca_error` son None
- THEN `parsed_data` contiene el resultado de la API

#### Scenario: TaskResult desde BrowserTask

- GIVEN un BrowserTask que completa OK
- WHEN `execute()` retorna
- THEN `success` es True
- THEN `task_id` no es None
- THEN `parsed_data` contiene el JSON extraído

### REQ-3: VencimientosDeudasTask — Rename from FullTask

`VencimientosDeudasTask(BrowserTask)` SHALL ser una subclase concreta que ejecuta `TEMPLATE_FULL` (login + switch + extract combinado). Es el DEFAULT para mantener compatibilidad hacia atrás. El alias `FullTask` SHALL mantenerse como backward-compatible import en `fiscal_agent/browser/__init__.py`.

MUST:
- Usar `TEMPLATE_FULL` como template
- Parsear output con `_parse_extract_output()` existente
- Devolver `parsed_data` con estructura `{vencimientos: [], deudas: []}` idéntica
- `__init__.py` DEBE exportar `from ... import VencimientosDeudasTask as FullTask`

#### Scenario: VencimientosDeudasTask produce mismo output

- GIVEN output crudo de TEMPLATE_FULL
- WHEN `parse_output(raw)` se ejecuta
- THEN retorna dict con `vencimientos` y `deudas`
- THEN el formato es idéntico al `_parse_extract_output()` actual

#### Scenario: Backward compatible alias

- GIVEN `from fiscal_agent.browser import FullTask`
- WHEN se usa `FullTask(...)`
- THEN instancia `VencimientosDeudasTask`
- THEN comportamiento es idéntico

### REQ-4: LoginTask y ExtractV2Task

`LoginTask(BrowserTask)` SHALL ser una subclase que ejecuta `TEMPLATE_LOGIN`. Usa `secrets` y `start_url`. No produce datos parseados (solo autentica).

`ExtractV2Task(BrowserTask)` SHALL ejecutar un template de extracción para ctacte.cloud. Asume sesión autenticada (session_id existente). Produce `{vencimientos: [], deudas: []}`.

### REQ-5: FacilidadesTask

`FacilidadesTask(BrowserTask)` SHALL ejecutar el template de Mis Facilidades con timeout default de 300s.

MUST:
- Usar template de misFacilidades como instrucción NL
- Parsear output de tabla de deuda
- Tener `timeout = 300` por defecto

#### Scenario: FacilidadesTask timeout extendido

- GIVEN un FacilidadesTask construido sin timeout explícito
- WHEN se accede a `timeout`
- THEN es 300

## Non-Functional Requirements

| ID | Requisito | Target |
|----|-----------|--------|
| NFR-BT1 | Sin dependencias nuevas | MUST no agregar dependencias a pyproject.toml |
| NFR-BT2 | Backward compatible | MUST mantener `run_single()` y `run_all()` sin cambios de firma |
| NFR-BT3 | Parseo robusto | MUST aplicar las 3 estrategias de parseo existentes (JSON directo, desescape, brace-matching) |

## Data Contracts

| Entrada | Salida |
|---------|--------|
| `BrowserTask(name, template, params, ...)` | `TaskResult(success, raw_output, parsed_data, ...)` |
| `[BrowserTask]` secuencial con session_id compartido | `list[TaskResult]` uno por task |

## File Manifest

| Archivo | Rol |
|---------|-----|
| `fiscal_agent/browser/task.py` (NUEVO) | `BrowserTask` ABC, `TaskResult`, `FullTask`, `LoginTask`, `ExtractV2Task` |
