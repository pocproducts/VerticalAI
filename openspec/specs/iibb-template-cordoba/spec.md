# IIBB Template — Córdoba Specification

## Purpose

Template NL para extracción de IIBB desde Rentas Córdoba vía el RUT de ARCA. Es el template por defecto para todas las provincias cuando no hay un template específico configurado.

## Requirements

### Requirement: Córdoba template constant

The system MUST export `TEMPLATE_IIBB_CORDOBA` from `fiscal_agent.browser.workflows.iibb.cordoba`.

#### Scenario: Constant is importable from subpackage

- GIVEN `from fiscal_agent.browser.workflows.iibb.cordoba import TEMPLATE_IIBB_CORDOBA`
- WHEN the import is executed
- THEN `TEMPLATE_IIBB_CORDOBA` MUST be a non-empty string

### Requirement: Content identical to original TEMPLATE_IIBB

The template content MUST be identical to the original `TEMPLATE_IIBB` from the old `iibb.py` module.

#### Scenario: Content preserved on relocation

- GIVEN the original `TEMPLATE_IIBB` content from `workflows/iibb.py`
- WHEN comparing with `TEMPLATE_IIBB_CORDOBA`
- THEN they MUST be identical strings (same instructions, placeholders, output format)

### Requirement: Backward compatible import alias

The system MUST re-export `TEMPLATE_IIBB` (old name) from `fiscal_agent.browser.workflows.__init__.py` as an alias for `TEMPLATE_IIBB_CORDOBA`.

#### Scenario: Old import path still works

- GIVEN `from fiscal_agent.browser.workflows import TEMPLATE_IIBB`
- WHEN the import is executed
- THEN `TEMPLATE_IIBB` MUST reference the same string object as `TEMPLATE_IIBB_CORDOBA`
- AND `TEMPLATE_IIBB is TEMPLATE_IIBB_CORDOBA` MUST be `True`
