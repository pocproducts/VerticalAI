# BaseTask Specification

> Protocolo abstracto unificado para toda operación del sistema — browser, SOAP, REST. `BaseTask` define la interfaz que cualquier task debe implementar; `ApiTask` extiende para calls síncronas sin Composio; `PipelineStep` despacha uniformemente ambas jerarquías.

## Purpose

Unificar BrowserTask y nuevas API tasks bajo un protocolo `BaseTask` común para que el orquestador despache cualquier tipo sin conocer su implementación. `TaskResult` se comparte entre todas las jerarquías.

## Requirements

### REQ-1: BaseTask ABC

`BaseTask` SHALL ser una ABC que define el contrato para toda task del sistema.

MUST exponer:
- `name: str` — identificador único
- `timeout: int` — timeout en segundos (default 300)
- `parse_output(raw: Any) -> dict` — parsea output crudo
- `execute(context: dict) -> TaskResult` — ejecuta la operación

#### Scenario: BaseTask completa

- GIVEN una subclase concreta de BaseTask
- WHEN se construye
- THEN `name` y `timeout` están definidos
- THEN `parse_output()` y `execute()` son implementados

### REQ-2: ApiTask(BaseTask)

`ApiTask(BaseTask)` SHALL ser ABC para tasks que ejecutan llamadas API síncronas (SOAP/REST) sin Composio.

MUST incluir:
- `needs_ta: bool` — True si requiere Ticket de Acceso
- `needs_certs: bool` — True si requiere certificado X.509

#### Scenario: ApiTask sin browser

- GIVEN una ApiTask concreta
- WHEN `execute()` se invoca
- THEN la llamada corre directo (sin Composio ni browser)

### REQ-3: TaskResult Reusable

`TaskResult` SHALL ser un dataclass reusable por BrowserTask y ApiTask.

MUST contener:
- `task_name: str`
- `success: bool`
- `raw_output: str`
- `parsed_data: dict`
- `error: Optional[str]`

#### Scenario: TaskResult compartido

- GIVEN un TaskResult de ApiTask o BrowserTask
- WHEN se inspecciona
- THEN tiene `task_name`, `success`, `parsed_data`
- THEN la estructura es idéntica para ambas jerarquías

### REQ-4: PipelineStep Dispatcher

`PipelineStep` SHALL aceptar cualquier `BaseTask` y despachar según su tipo.

MUST:
- Browser tasks → ejecutar vía sesión Composio
- API tasks → ejecutar directo (thread pool)
- Fallar rápido si task no tiene handler registrado

#### Scenario: Dispatch mixto

- GIVEN una lista con BrowserTask + ApiTask
- WHEN `PipelineStep.run()` ejecuta
- THEN BrowserTask corre vía Composio
- THEN ApiTask corre directo
- THEN ambos resultados son `list[TaskResult]`

#### Scenario: Task desconocida

- GIVEN una task sin handler registrado
- WHEN `PipelineStep` intenta despachar
- THEN lanza ValueError
- THEN no ejecuta ninguna operación

## Verification

| ID | Método |
|----|--------|
| REQ-1 | `isinstance(BaseTask, ABC)` + método abstractos |
| REQ-2 | `isinstance(ApiTask, BaseTask)` + ejecución sin Composio |
| REQ-3 | Instanciar TaskResult desde BrowserTask y ApiTask |
| REQ-4 | PipelineStep.run([BrowserTask(), ApiTask()]) → 2 resultados |
