# IIBB Router Specification

## Purpose

Mapea un nombre de provincia al template NL correspondiente para extracción de IIBB. Centraliza la selección de template en un solo punto, permitiendo agregar nuevas provincias sin modificar el código cliente.

## Requirements

### Requirement: Router lookup

The system MUST provide an `IIBBRouter` class with a `get(provincia: str) -> str` method that returns the template string for a given province.

The mapping MUST include:
- `"CORDOBA"` → `TEMPLATE_IIBB_CORDOBA` (from `fiscal_agent.browser.workflows.iibb.cordoba`)
- `"JUJUY"` → `TEMPLATE_IIBB_JUJUY` (from `fiscal_agent.browser.workflows.iibb.jujuy`)

#### Scenario: Known province returns correct template

- GIVEN the string `"CORDOBA"`
- WHEN `IIBBRouter.get("CORDOBA")` is called
- THEN it MUST return the `TEMPLATE_IIBB_CORDOBA` constant value

#### Scenario: Jujuy province returns Jujuy template

- GIVEN the string `"JUJUY"`
- WHEN `IIBBRouter.get("JUJUY")` is called
- THEN it MUST return the `TEMPLATE_IIBB_JUJUY` constant value

### Requirement: Fallback to Córdoba

The system MUST fall back to `TEMPLATE_IIBB_CORDOBA` when the province is unknown, ensuring backward compatibility with existing behavior.

#### Scenario: Unknown province falls back

- GIVEN the string `"DESCONOCIDA"`
- WHEN `IIBBRouter.get("DESCONOCIDA")` is called
- THEN it MUST return `TEMPLATE_IIBB_CORDOBA`

#### Scenario: None input falls back

- GIVEN `None` as input
- WHEN `IIBBRouter.get(None)` is called
- THEN it MUST return `TEMPLATE_IIBB_CORDOBA`

#### Scenario: Empty string falls back

- GIVEN an empty string `""` as input
- WHEN `IIBBRouter.get("")` is called
- THEN it MUST return `TEMPLATE_IIBB_CORDOBA`

### Requirement: Case-insensitive matching

The system MUST match province names case-insensitively, so `"cordoba"`, `"Cordoba"`, and `"CORDOBA"` all resolve to the same template.

#### Scenario: Lowercase input

- GIVEN the string `"cordoba"`
- WHEN `IIBBRouter.get("cordoba")` is called
- THEN it MUST return `TEMPLATE_IIBB_CORDOBA`

#### Scenario: Mixed case input

- GIVEN the string `"Jujuy"`
- WHEN `IIBBRouter.get("Jujuy")` is called
- THEN it MUST return `TEMPLATE_IIBB_JUJUY`
