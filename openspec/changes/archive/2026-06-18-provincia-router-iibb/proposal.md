# Proposal: Provincia Router + IIBB Jujuy

## Intent

El template IIBB está hardcodeado a Rentas Córdoba. Necesitamos un router provincia → template y un stub Jujuy para validar el flujo multi-provincia.

## Scope

### In Scope
- `workflows/iibb.py` → `workflows/iibb/cordoba.py` (rename `TEMPLATE_IIBB` → `TEMPLATE_IIBB_CORDOBA`)
- `workflows/iibb/__init__.py`, `jujuy.py` (stub), `browser/iibb_router.py`
- IIBBTask recibe `provincia`, usa router → `factory.py`, `pipeline/service.py` lo pasan

### Out of Scope
- Portal real DGR Jujuy, refactor `matching.py`, multi-tenant, Clerk

## Capabilities

### New
- `iibb-router`: mapea provincia → template NL, fallback Córdoba

### Modified
- `browser-task`: IIBBTask acepta `provincia: str`, usa router
- `pipeline`: pasa `provincia` desde `ClientConfig.provincias`

## Approach

1. Crear `workflows/iibb/` subpackage. Mover `cordoba.py`, borrar `iibb.py`.
2. `IIBBRouter` con dict + `get(provincia)` + fallback Córdoba.
3. `IIBBTask.__init__(provincia)` → `self.template = IIBBRouter.get(provincia)`.
4. `build_browser_tasks(provincia=None)` → pasa a IIBBTask.
5. `PipelineService` toma `cliente.provincias[0]` y lo pasa al builder.
6. Jujuy stub: login AFIP → reporta "no implementada" → arrays vacíos.

## Affected Areas

| Area | Impact |
|------|--------|
| `workflows/iibb.py` | Removed (→ `iibb/cordoba.py`) |
| `workflows/iibb/{__init__,cordoba,jujuy}.py` | New |
| `browser/iibb_router.py` | New |
| `browser/task.py`, `factory.py` | Modified |
| `workflows/__init__.py`, `pipeline/service.py` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Pipeline sin provincia rompe | Low | Default None → router fallback Córdoba |
| Import olvidado de iibb.py | Low | `rg "from.*iibb[^_]"` pre-merge |

## Rollback Plan

Revertir commit. `TEMPLATE_IIBB` como fallback en router asegura transición segura.

## Success Criteria

- [ ] `IIBBRouter.get('CORDOBA')` → `TEMPLATE_IIBB_CORDOBA`
- [ ] `IIBBRouter.get('JUJUY')` → `TEMPLATE_IIBB_JUJUY`
- [ ] `IIBBRouter.get('DESCONOCIDA')` → fallback Córdoba
- [ ] IIBBTask con `provincia='JUJUY'` ejecuta stub sin error
- [ ] Pipeline con `with_iibb=True` pasa provincia, no rompe
