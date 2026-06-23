# Archive Report

**Change**: provincia-router-iibb
**Date**: 2026-06-18
**Mode**: openspec

## What Was Implemented

Provincia router for IIBB templates — decoupled hardcoded Córdoba template into a province-routing architecture with a Jujuy stub:

- **IIBBRouter** class — maps province name to template NL with case-insensitive matching and Córdoba fallback
- **workflows/iibb/** subpackage — `cordoba.py` (moved + renamed constant), `jujuy.py` (stub), `__init__.py` (re-exports)
- **IIBBTask** — accepts `provincia` parameter, resolves template via router at instance level
- **build_browser_tasks** — accepts optional `provincia` parameter, passes to IIBBTask
- **PipelineService** — derives provincia from `ClientConfig.provincias` via `_derive_iibb_provincia()`
- **Backward compat** — `TEMPLATE_IIBB = TEMPLATE_IIBB_CORDOBA` alias in `workflows/__init__.py`
- **Old iibb.py deleted** — zero orphaned imports confirmed

## Specs Synced

| Domain | Action | Details |
|--------|--------|---------|
| `iibb-router` | Created | New spec at `openspec/specs/iibb-router/spec.md` — Router lookup, fallback, case-insensitive matching (7 scenarios) |
| `iibb-template-cordoba` | Created | New spec at `openspec/specs/iibb-template-cordoba/spec.md` — Template constant, content preservation, backward compat alias (3 scenarios) |
| `iibb-template-jujuy` | Created | New spec at `openspec/specs/iibb-template-jujuy/spec.md` — Template constant, subpackage export, stub behavior (4 scenarios) |
| `browser-task` | Updated | Merged delta `iibb-task-refactor` → added REQ "IIBBTask province-aware" with 3 scenarios |
| `pipeline` | Updated | Merged delta `pipeline-iibb` → added REQ-6 (provincia derivation, 4 scenarios) + REQ-7 (build_browser_tasks provincia, 3 scenarios) |

## Verification Summary

- **Tasks**: 9/9 complete
- **Spec scenarios**: 23/23 compliant (100%)
- **Verdict**: PASS
- **Critical issues**: None
- **Warnings**: None

## Open Items

**SUGGESTION** (from verify report):
- No dedicated pytest tests exist for `IIBBRouter`, `IIBBTask` provincia awareness, `_derive_iibb_provincia`, or `build_browser_tasks` provincia parameter. Consider adding unit tests in a follow-up to prevent regressions.

## Delta Sync Notes

- **iibb-router**, **iibb-template-cordoba**, **iibb-template-jujuy**: Full new specs (no existing main spec) — copied directly to `openspec/specs/<domain>/spec.md`
- **iibb-task-refactor**: Delta targeting `openspec/specs/browser-task/spec.md` — appended as new requirement "IIBBTask province-aware" after FacilidadesTask, before Non-Functional Requirements
- **pipeline-iibb**: Delta targeting `openspec/specs/pipeline/spec.md` — appended as REQ-6 and REQ-7 after REQ-5, before Non-Functional Requirements
- No destructive merges performed — all additions were non-destructive appends. All existing requirements in both browser-task and pipeline specs preserved intact.

## Archive Contents

| Artifact | Status |
|----------|--------|
| `proposal.md` | ✅ |
| `design.md` | ✅ |
| `tasks.md` | ✅ |
| `specs/` (5 delta specs) | ✅ |
| `verify-report.md` | ✅ |
| `archive-report.md` | ✅ |

## SDD Cycle Complete

The change has been fully planned, designed, implemented, verified, and archived. Ready for the next change.
