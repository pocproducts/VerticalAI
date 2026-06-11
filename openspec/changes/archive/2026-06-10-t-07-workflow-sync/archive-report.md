# Archive Report: t-07-workflow-sync (Workflow Browser Synchronization)

**Archived**: 2026-06-10
**Mode**: OpenSpec (file-based)

---

## Change Summary

Shared browser lifecycle for ARCA extraction. `ArcaExtractor` now owns one Playwright Browser, passes it to workflow YAML files, and keeps the session alive across login → switch → extract stages. Key capabilities:

- **Single Browser Ownership**: One Browser per `ArcaExtractor` lifecycle, lazy-initialized, shared across all workflow executions
- **Workflow-First Execution**: Each operation loads workflow YAML first, falls back to Agent on failure with the same Browser
- **Session Heartbeat**: Background async task pings ARCA via `fetch()` every 60s to prevent 4-min session expiry
- **ARCA Error Handling**: Distinct detection and handling for ARCA-4 (bad creds), ARCA-5 (portal down), ARCA-6 (2FA), and session expiry
- **Always Clean Up**: `finally` block in `run_all()` always calls `close()`, safe when `_browser` is `None`
- **Configurable Heartbeat**: `ARCA_HEARTBEAT_INTERVAL` env var (default 60s, invalid values fall back to 60s)
- **Schema Fix**: `login_estudio.workflow.yaml` final step changed from `validate` to `extract` to pass `validate_ends_with_extract`

## Delta Between Spec and Final Implementation

### Files Modified
| File | Action | Lines |
|------|--------|-------|
| `fiscal_agent/arca_extractor.py` | Modified | 540 → 551 |
| `fiscal_agent/workflows/arca/login_estudio.workflow.yaml` | Modified | 70 → 73 |
| `tests/test_arca_extractor.py` | Created | 151 lines |

### Design Deviations (Minor)
1. **`_switch_with_workflow` catches `FileNotFoundError` separately** (extra safety): Design says `_load_workflow` wraps all errors in `ValueError`. Code explicitly catches `(ValueError, FileNotFoundError)` at line 343 since `switch_representado.workflow.yaml` doesn't exist yet (T-07b pending). Non-harmful, functionally equivalent.

2. **Heartbeat pause event semantics inverted**: Design documents `await self._heartbeat_paused.wait()`. Implementation uses `wait()` correctly with inverted semantics: `set()` = running (wait returns), `clear()` = paused (wait blocks). `_heartbeat_start()` calls `.set()`, `run_all()` calls `.clear()` before switch and `.set()` after. Design matched exactly after T-07c-8 fix.

### Spec Delta: No Delta Spec Files
The change's `specs/arca-browser-sync/` directory was empty (no delta spec). The root `spec.md` contained the full specification. Both files have been synced:
- Root spec → main spec at `openspec/specs/arca-browser-sync/spec.md` (created)

## Tasks Completed (10/10)

| Task | Status | Description |
|------|--------|-------------|
| T-07c-1 | ✅ Done | Fix login_estudio.workflow.yaml last step type (`validate` → `extract`) |
| T-07c-2 | ✅ Done | Extract `_login_with_agent()` and `_switch_with_agent()` methods |
| T-07c-3 | ✅ Done | Add `_load_workflow()` and `_run_workflow()` infrastructure |
| T-07c-4 | ✅ Done | Workflow-first integration: `login()` and `switch_representado()` try workflow first |
| T-07c-5 | ✅ Done | Add heartbeat lifecycle (`_heartbeat_start/_stop`, pause/resume) |
| T-07c-6 | ✅ Done | Session expiry detection (`_detect_session_expired()`) and auto re-login |
| T-07c-7 | ✅ Done | `ARCA_HEARTBEAT_INTERVAL` env var support (NFR-3) |
| T-07c-8 | ✅ Done | Fix heartbeat busy-wait → event-driven `asyncio.Event.wait()` |
| T-07c-9 | ✅ Done | Unit tests for `_es_error_2fa()` and `_es_error_credencial()` (18 tests) |
| T-07c-10 | ✅ Done | Schema validation test for `login_estudio.workflow.yaml` (2 tests) |

## Verification Verdict

**PASS WITH WARNINGS**

- **Build**: ✅ Syntax OK (`uv run python -c "import ast; ast.parse(...)"`)
- **Tests**: ✅ **20/20 PASS** (18 error detection unit tests + 2 schema validation tests)
- **Spec compliance**: 3/13 scenarios with automated tests (ARCA-4, ARCA-6, REQ-7)
- **5 UNTESTED scenarios**: Agent fallback path, heartbeat timing, portal-down retry, session expiry recovery, partial failure — require async integration testing

### Engram Observation IDs
- Apply-progress: #612 (topic `sdd/t-07-workflow-sync/apply-progress`)

## Archive Contents

- proposal.md ✅
- spec.md ✅
- specs/ ✅ (empty dir)
- design.md ✅
- tasks.md ✅
- verify-report.md ✅
- archive-report.md ✅

## Source of Truth Updated

The following main spec now reflects the new behavior:
- `openspec/specs/arca-browser-sync/spec.md` — Created (full spec copied from change)

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived.
Ready for the next change.
