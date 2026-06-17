# ARCA WS Task Specification

> `PadronApiTask(ApiTask)` — wrapping de `consultar_cuit()` del WS ARCA A5 como una task del sistema. Permite al orquestador ejecutar consultas SOAP al padrón con el mismo protocolo que las browser tasks.

## Purpose

Integrar la consulta al Padrón A5 (SOAP de ARCA, `arca_ws.py`) como una `ApiTask` concreta para que el pipeline la despache uniformemente junto con browser tasks.

## Requirements

### REQ-API-1: PadronApiTask

`PadronApiTask(ApiTask)` SHALL wrap `consultar_cuit()` de `arca_ws.py` y devolver `PadronA5Output`.

MUST:
- Tener `name = 'padron_a5'`
- Setear `needs_ta = True` y `needs_certs = True`
- Llamar `consultar_cuit(cuit, token, sign, representante_cuit)` en `execute()`
- Retornar `TaskResult` con `parsed_data` conteniendo `PadronA5Output`

#### Scenario: Consulta exitosa

- GIVEN CUIT válido + TA vigente + certificados OK
- WHEN `PadronApiTask.execute(context)` se invoca
- THEN llama `consultar_cuit()` con parámetros del context
- THEN `success = True`
- THEN `parsed_data` contiene `PadronA5Output` completo

#### Scenario: Error SOAP

- GIVEN CUIT inválido o error de constancia
- WHEN `consultar_cuit()` retorna con error
- THEN `success = False`
- THEN `parsed_data` contiene `PadronA5Output` con `errorConstancia`
- THEN `error` describe la causa

### REQ-API-2: Context de Ejecución

`PadronApiTask.execute()` SHALL aceptar un `context: dict` con los parámetros necesarios para la consulta SOAP.

MUST extraer del context:
- `token: str` — TA vigente
- `sign: str` — firma del TA
- `representante_cuit: str` — CUIT del estudio/representante
- `cuit: str` — CUIT a consultar (puede venir del constructor)

#### Scenario: Context completo

- GIVEN un context con `token`, `sign`, `representante_cuit`
- WHEN `execute(context)` se ejecuta
- THEN pasa los valores a `consultar_cuit()`
- THEN no requiere archivos de certificado (ya se obtuvieron antes)

#### Scenario: Context incompleto

- GIVEN un context sin `token`
- WHEN `execute(context)` se ejecuta
- THEN lanza KeyError o ValueError
- THEN error describe el campo faltante

## Verification

| ID | Método |
|----|--------|
| REQ-API-1 | `PadronApiTask().execute(ctx)` → TaskResult con PadronA5Output |
| REQ-API-2 | Test unitario: context sin token → error |
