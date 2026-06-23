# Delta for browser-task

Base spec: `openspec/specs/browser-task/spec.md`

## ADDED Requirements

### Requirement: IIBBTask province-aware

`IIBBTask(BrowserTask)` SHALL accept an optional `provincia: str = 'CORDOBA'` parameter. When provided, it SHALL use `IIBBRouter.get(provincia)` to select the IIBB template. When omitted, it SHALL default to `TEMPLATE_IIBB_CORDOBA` (backward compatible).

MUST:
- Accept `provincia` as optional keyword argument with default `'CORDOBA'`
- Use `IIBBRouter.get(provincia)` to resolve `self.template`
- Preserve all existing constructor parameters (`cuit`, `clave`, `cliente_cuit`)
- Keep `name = 'iibb'` and `needs_auth = True`

#### Scenario: With provincia=JUJUY

- GIVEN `IIBBTask(cuit=..., clave=..., cliente_cuit=..., provincia='JUJUY')`
- WHEN the task is constructed
- THEN `self.template` MUST be `TEMPLATE_IIBB_JUJUY`
- AND `self.name` MUST be `'iibb'`
- AND `self.needs_auth` MUST be `True`

#### Scenario: Without provincia (backward compat)

- GIVEN `IIBBTask(cuit=..., clave=..., cliente_cuit=...)`
- WHEN the task is constructed without a `provincia` argument
- THEN `self.template` MUST be `TEMPLATE_IIBB_CORDOBA`

#### Scenario: With provincia=CORDOBA (explicit)

- GIVEN `IIBBTask(cuit=..., clave=..., cliente_cuit=..., provincia='CORDOBA')`
- WHEN the task is constructed
- THEN `self.template` MUST be `TEMPLATE_IIBB_CORDOBA`
