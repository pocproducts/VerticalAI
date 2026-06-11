# browser-task Specification

> BrowserTask protocol — abstraction para operaciones de navegación atómicas en Composio Browser Tool. Cada BrowserTask es una unidad independiente que puede ejecutarse en una sesión Composio compartida.

## Purpose

Desacoplar la lógica de navegación (templates NL) del orquestador de sesiones Composio. Cada tarea de navegación (login, extraer deuda, descargar certificado, etc.) se define como un `BrowserTask` autónomo. El orquestador itera tasks compartiendo el mismo `session_id` de Composio, evitando relogueos y permitiendo agregar nuevas tareas sin tocar el orquestador.

## Requirements

### REQ-1: BrowserTask Protocol

`BrowserTask` SHALL ser un protocol / ABC que define la interfaz para una operación de navegación atómica en Composio.

MUST exponer:
- `name: str` — identificador único de la tarea
- `template: str` — template NL con placeholders
- `template_params: dict` — parámetros para `template.format()`
- `secrets: Optional[dict]` — credenciales HTTP básicas para la sesión
- `start_url: Optional[str]` — URL inicial de navegación
- `needs_auth: bool` — True si requiere login previo (crea sesión nueva)
- `timeout: int` — timeout en segundos para WATCH_TASK
- `parse_output(raw: str) -> dict` — método que parsea el output del AI agent

#### Scenario: BrowserTask completo

- GIVEN un BrowserTask con template, params y secrets
- WHEN se construye
- THEN tiene `name` y `template` no vacíos
- THEN `timeout` tiene valor por defecto 300
- THEN `needs_auth` es True por defecto

### REQ-2: TaskResult

`TaskResult` SHALL ser un dataclass que captura el resultado de UNA ejecución de BrowserTask.

MUST contener:
- `task_name: str` — nombre de la tarea
- `success: bool` — True si completó sin errores
- `raw_output: str` — output crudo del AI agent
- `parsed_data: dict` — JSON parseado
- `arca_error: Optional[str]` — error ARCA-4/ARCA-6 si ocurrió
- `task_id: Optional[str]` — ID de la task Composio
- `error: Optional[str]` — cualquier otro error

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

### REQ-3: FullTask — Compatibilidad

`FullTask(BrowserTask)` SHALL ser una subclase concreta que ejecuta `TEMPLATE_FULL` (login + switch + extract combinado). Es el DEFAULT para mantener compatibilidad hacia atrás.

MUST:
- Usar `TEMPLATE_FULL` como template
- Parsear output con `_parse_extract_output()` existente
- Devolver `parsed_data` con estructura `{vencimientos: [], deudas: []}` idéntica a la actual

#### Scenario: FullTask produce mismo output

- GIVEN output crudo de TEMPLATE_FULL
- WHEN `parse_output(raw)` se ejecuta
- THEN retorna dict con `vencimientos` y `deudas`
- THEN el formato es idéntico al `_parse_extract_output()` actual

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
