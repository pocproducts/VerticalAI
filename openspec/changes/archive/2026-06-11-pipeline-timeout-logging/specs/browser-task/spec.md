# Delta for browser-task

## MODIFIED Requirements

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
- THEN `timeout` tiene valor por defecto **300**
- THEN `needs_auth` es True por defecto
(Previously: default timeout era 120s)

## ADDED Requirements

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
