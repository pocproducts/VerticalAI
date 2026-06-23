# IIBB Template — Jujuy Specification

## Purpose

Provee un stub de template NL para extracción de IIBB en DGR Jujuy. El stub implementa el flujo de login AFIP y reporta que la integración con DGR Jujuy no está implementada aún, devolviendo arrays vacíos de jurisdicciones y cuotas vencidas.

## Requirements

### Requirement: Jujuy template constant

The system MUST export `TEMPLATE_IIBB_JUJUY` from `fiscal_agent.browser.workflows.iibb.jujuy`.

#### Scenario: Constant is importable

- GIVEN `from fiscal_agent.browser.workflows.iibb.jujuy import TEMPLATE_IIBB_JUJUY`
- WHEN the import is executed
- THEN `TEMPLATE_IIBB_JUJUY` MUST be a non-empty string

#### Scenario: Template in __init__.py

- GIVEN `from fiscal_agent.browser.workflows.iibb import TEMPLATE_IIBB_JUJUY`
- WHEN the import is executed
- THEN the subpackage `iibb` MUST export the constant

### Requirement: Stub behavior

The template MUST instruct the AI agent to log in to AFIP (same login flow as Córdoba), then report that "DGR Jujuy no implementada aún" and return empty arrays.

#### Scenario: Stub returns empty arrays

- GIVEN an AI agent executing the Jujuy stub template
- WHEN the task completes
- THEN the output JSON MUST contain `iibb_jurisdicciones: []` and `cuotas_vencidas: []`
- AND `success` MUST be `true`

#### Scenario: Structured JSON output

- GIVEN the template executes as a Composio task
- WHEN the AI agent calls `done(...)` with the JSON
- THEN the output MUST be parseable by `_parse_iibb_output()`
- AND the parsed dict MUST contain both `iibb_jurisdicciones` and `cuotas_vencidas` as empty lists
