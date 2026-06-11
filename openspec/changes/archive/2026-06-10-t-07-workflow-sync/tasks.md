# Tasks: T-07 Workflow Browser Synchronization

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~400 |
| 400-line budget risk | Medium |
| Decision needed before apply | No |
| Chained PRs recommended | No |
| Chain strategy | size-exception |

```
Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium
```

**Note**: `switch_representado.workflow.yaml` does NOT exist yet (T-07b recording task). The code handles this gracefully — `_load_workflow()` will raise `FileNotFoundError`, caught by the caller which falls back to Agent. No change needed here, but the dependency is documented.

---

## Task Group 1: Workflow Schema Fix

### T-07c-1: Fix login_estudio.workflow.yaml last step type

- **Name**: Fix login_estudio schema validation
- **Description**: Change the workflow file's final step from type `validate` to type `extract` to pass the `validate_ends_with_extract` validator in `WorkflowDefinitionSchema`. Replace the `validate_authenticated` step (lines 66–70) with an `extract_auth_result` step that outputs `{authenticated: bool, study_cuit: string}`.
- **Files affected**:
  - `fiscal_agent/workflows/arca/login_estudio.workflow.yaml` (modify)
- **Dependencies**: None
- **Acceptance criteria**:
  - [ ] `WorkflowDefinitionSchema(**yaml_data)` loads without `ValidationError`
  - [ ] Last step type is `extract` (not `validate`)
  - [ ] `extractionGoal` asks for `authenticated` and `study_cuit` in JSON
  - [ ] Input/output schema unchanged
  - [ ] All existing tests that load this YAML still pass
- **Effort**: Small
- **Est. lines**: ~5 changed

---

## Task Group 2: Agent Path Extraction (Safe Refactor)

### T-07c-2: Extract Agent-based login and switch into dedicated methods

- **Name**: Extract _login_with_agent and _switch_with_agent
- **Description**: Extract the existing Agent-based code from `login()` (lines 141–204) into a new `_login_with_agent() -> bool` method, and from `switch_representado()` (lines 206–244) into a new `_switch_with_agent(cuit: str) -> bool`. The original methods delegate to these after extraction. This is a pure refactor — no behavior change. The extraction sets up the structure needed for the workflow-first pattern.
- **Files affected**:
  - `fiscal_agent/arca_extractor.py` (modify)
- **Dependencies**: None
- **Acceptance criteria**:
  - [ ] `_login_with_agent()` contains the Agent task prompt, `_make_agent()`, retry loop with `RETRY_DELAYS`, ARCA-4/ARCA-5/ARCA-6 detection, all logging
  - [ ] `_switch_with_agent(cuit)` contains the Agent task prompt, `_make_agent()`, error handling
  - [ ] `login()` calls `_login_with_agent()` and returns its result
  - [ ] `switch_representado(cuit)` calls `_switch_with_agent(cuit)` and returns its result
  - [ ] Existing behavior is identical (same retry logic, same error detection, same logging messages)
- **Effort**: Small
- **Est. lines**: ~60 moved/refactored

---

## Task Group 3: Workflow Infrastructure

### T-07c-3: Add _load_workflow() and _run_workflow() methods

- **Name**: Add workflow loading and execution infrastructure
- **Description**: Add two new methods to `ArcaExtractor` that serve as the interface between the extractor and the workflow engine:
  - `_load_workflow(filename: str) -> WorkflowDefinitionSchema`: Resolves the filename relative to `fiscal_agent/workflows/arca/`, loads YAML, parses via `WorkflowDefinitionSchema`. Returns the validated schema. Catches `FileNotFoundError`, `yaml.YAMLError`, and `ValidationError` → re-raises as `ValueError` for consistent error handling.
  - `_run_workflow(schema: WorkflowDefinitionSchema, inputs: dict) -> bool`: Instantiates `Workflow(schema, llm=self._llm, browser=self._browser)`, calls `await workflow.run(inputs, close_browser_at_end=False)`. Returns `True` on success. On exception from `Workflow.run()`, re-raises as `ValueError` to trigger Agent fallback in the caller.
- **Files affected**:
  - `fiscal_agent/arca_extractor.py` (modify)
- **Dependencies**: None (new methods, no existing code changed)
- **Acceptance criteria**:
  - [ ] `_load_workflow('login_estudio.workflow.yaml')` → valid `WorkflowDefinitionSchema`
  - [ ] `_load_workflow('nonexistent.yaml')` → raises `ValueError` (wraps `FileNotFoundError`)
  - [ ] `_load_workflow('invalid.yaml')` → raises `ValueError` (wraps Pydantic `ValidationError`)
  - [ ] `_run_workflow(schema, inputs)` calls `Workflow.run()` with `close_browser_at_end=False`
  - [ ] `_run_workflow` returns `True` on successful workflow completion
  - [ ] `_run_workflow` raises `ValueError` when `Workflow.run()` raises
  - [ ] Both methods are `async`
  - [ ] Imports: `from workflow_use.schema.views import WorkflowDefinitionSchema`, `from workflow_use.workflow.service import Workflow`
- **Effort**: Small
- **Est. lines**: ~30 new

---

## Task Group 4: Workflow-First Integration

### T-07c-4: Add workflow-first methods and refactor login() / switch_representado()

- **Name**: Add _login_with_workflow, _switch_with_workflow and refactor entry points
- **Description**: Add two workflow-first methods and modify the public API to try workflows first before falling back to Agent:

  **New methods**:
  - `_login_with_workflow() -> bool`: Calls `_run_workflow(_load_workflow('login_estudio.workflow.yaml'), {cuit: self.estudio_cuit, clave_fiscal: self.estudio_clave})`. On success → `self._authenticated=True`, `self._current_cuit=self.estudio_cuit`, return `True`. On `ValueError` → return `False` (triggers Agent fallback in caller).
  - `_switch_with_workflow(cuit: str) -> bool`: Calls `_run_workflow(_load_workflow('switch_representado.workflow.yaml'), {target_cuit: cuit})`. On success → `self._current_cuit=cuit`, return `True`. On `ValueError` → return `False`.

  **Modified methods**:
  - `login()`: Call `_login_with_workflow()` first. If it returns `True`, return `True`. Otherwise, log "Workflow login failed, falling back to Agent" and call `_login_with_agent()`. Apply ARCA error handling (2FA/bad creds skip, portal down retry 3×) to both paths.
  - `switch_representado(cuit)`: Call `_switch_with_workflow(cuit)` first. If it returns `True`, return `True`. Otherwise, log "Workflow switch failed, falling back to Agent" and call `_switch_with_agent(cuit)`.
- **Files affected**:
  - `fiscal_agent/arca_extractor.py` (modify)
- **Dependencies**: T-07c-2 (Agent extraction), T-07c-3 (workflow infrastructure)
- **Acceptance criteria**:
  - [ ] `login()` calls `_login_with_workflow()` first
  - [ ] When workflow succeeds, `_authenticated == True` and method returns `True`
  - [ ] When workflow raises, `_login_with_agent()` is called as fallback
  - [ ] Log messages distinguish workflow path vs Agent path
  - [ ] `switch_representado(cuit)` calls `_switch_with_workflow(cuit)` first
  - [ ] When workflow succeeds, `_current_cuit == cuit` and method returns `True`
  - [ ] When workflow fails (file not found), gracefully falls back to `_switch_with_agent()`
  - [ ] `_login_with_workflow()` passes `{cuit, clave_fiscal}` as workflow inputs
  - [ ] `_switch_with_workflow()` passes `{target_cuit: cuit}` as workflow inputs
  - [ ] Same `self._browser` instance is used across both workflow and Agent paths
- **Effort**: Medium
- **Est. lines**: ~55 new/changed

---

## Task Group 5: Session Heartbeat

### T-07c-5: Add background heartbeat and integrate with run_all() / close()

- **Name**: Add _heartbeat lifecycle to keep ARCA session alive
- **Description**: Add a background async task that pings a benign ARCA URL every 60 seconds to prevent the ~4-minute session expiry. Integrate start/stop into `run_all()` and `close()`.

  **New methods + state**:
  - `self._heartbeat_active: bool = False` — guard for the heartbeat loop
  - `self._heartbeat_paused: asyncio.Event` — blocks heartbeat during workflow execution
  - `self._heartbeat_task: Optional[asyncio.Task] = None` — reference for cancellation
  - `_heartbeat_start()`: Set `_heartbeat_active = True`, create background task `_heartbeat_task = asyncio.create_task(self._heartbeat())`
  - `_heartbeat_stop()`: Set `_heartbeat_active = False`. If `_heartbeat_task` exists and not done, cancel it. Reset `_heartbeat_task = None`.
  - `_heartbeat()`: Loop while `_heartbeat_active`: wait for `_heartbeat_paused` to be clear, then `page.evaluate("fetch('/contribuyente_/', {method: 'HEAD'})")`, log debug on success or warning on failure, `await asyncio.sleep(60)`.

  **Modified methods**:
  - `run_all(clientes)`: After successful `login()`, call `_heartbeat_start()`. In the client loop: `_heartbeat_paused.clear()` before each `switch_representado()`, `_heartbeat_paused.set()` after. Wrap entire body in `try/finally` → `finally` calls `close()`.
  - `close()`: Call `_heartbeat_stop()` before closing browser. Keep existing cleanup (close browser, reset state).

- **Files affected**:
  - `fiscal_agent/arca_extractor.py` (modify)
- **Dependencies**: T-07c-4 (needs refactored login() and switch_representado() for run_all context)
- **Acceptance criteria**:
  - [ ] Heartbeat starts after `login()` succeeds in `run_all()`
  - [ ] Heartbeat fires `page.evaluate("fetch(...)")` every ~60s during client loop
  - [ ] Heartbeat pauses (via `_heartbeat_paused`) during `switch_representado()` execution
  - [ ] Heartbeat resumes after each client completes
  - [ ] `_heartbeat_stop()` is called in `close()` — task is canceled, loop exits
  - [ ] Heartbeat failure is non-fatal (logs warning, does not crash pipeline)
  - [ ] `run_all()` has `try/finally` → `close()` always runs
  - [ ] `close()` is safe to call when `_browser` is `None`
- **Effort**: Medium
- **Est. lines**: ~70 new/changed

---

## Task Group 6: Session Expiry Detection & Recovery

### T-07c-6: Add session expiry detection and automatic re-login

- **Name**: Add session expiry detection and recovery in client loop
- **Description**: Before each `switch_representado()` call in the client loop, detect if the ARCA session has expired by checking if the current page URL has redirected to the login page. If expired, re-execute `login()` before continuing with the switch.

  **New method**:
  - `_detect_session_expired() -> bool`: Gets current page URL via `self._browser.get_current_page().url()`. Returns `True` if URL contains `auth.afip.gob.ar/login` or similar session-expiry indicator. Catches exceptions and returns `False` (conservative — assume session is fine if we can't check).

  **Modified logic in `run_all()`**:
  - Before each `switch_representado()`: call `_detect_session_expired()`. If `True`:
    1. Log "Sesión expirada — re-login automático"
    2. Call `login()` (which runs workflow-first + Agent fallback)
    3. If re-login fails, append error for this client and `continue`
    4. If re-login succeeds, proceed with `switch_representado()` (retry)

  Also add `_detect_session_expired()` check inside the heartbeat failure handler — if heartbeat fails AND session is expired, log at warning level (the re-login in the client loop handles actual recovery).

- **Files affected**:
  - `fiscal_agent/arca_extractor.py` (modify)
- **Dependencies**: T-07c-4 (needs refactored login() and switch_representado()), T-07c-5 (needs heartbeat + run_all structure)
- **Acceptance criteria**:
  - [ ] `_detect_session_expired()` correctly identifies login page URL
  - [ ] Session expiry triggers automatic re-login before retrying the failed operation
  - [ ] If re-login succeeds, the current client's `switch_representado()` retries
  - [ ] If re-login fails, the current client is skipped with error logged
  - [ ] Detection is non-blocking — exceptions in URL check don't crash the pipeline
  - [ ] Log messages clearly indicate "Sesión expirada" and "Re-login" for audit trail
- **Effort**: Medium
- **Est. lines**: ~40 new/changed

---

## Dependencies Graph

```
T-07c-1 ──────── (independent — YAML file only)
                     
T-07c-2 ─────────┐   (independent — refactor only)
T-07c-3 ─────────┤   (independent — new infrastructure)
                  │
                  ├─── T-07c-4 ─────── T-07c-5 ─────── T-07c-6
                  │    (workflow-     (heartbeat +     (session expiry
                  │     first         run_all/close     detection +
                  │     integration)   integration)     recovery)
                  │
T-07c-1 ─────────┘
         (optional dep: T-07c-4 needs the YAML to be valid)
```

**Notes**:
- T-07c-1, T-07c-2, T-07c-3 are logically independent and could be implemented in any order
- T-07c-2 and T-07c-3 modify the same file (`arca_extractor.py`) so sequential apply is needed
- T-07c-4 depends on T-07c-2 (uses extracted Agent methods) and T-07c-3 (uses `_load_workflow`/`_run_workflow`)
- T-07c-5 depends on T-07c-4 (needs workflow-first login + switch in `run_all()`)
- T-07c-6 depends on T-07c-4 and T-07c-5 (needs both workflow-first ops and heartbeat lifecycle)
- `switch_representado.workflow.yaml` (T-07b) does NOT exist yet — `_switch_with_workflow()` falls through to Agent gracefully

---

## Task Group 7: NFR-3 — Configurable Heartbeat Interval

### T-07c-7: Add ARCA_HEARTBEAT_INTERVAL env var support

- **Name**: Make heartbeat interval configurable via env var
- **Description**: Read `ARCA_HEARTBEAT_INTERVAL` from `os.environ` with default `"60"`, parse as `int`, and pass to `_heartbeat()` as `sleep(interval)` instead of hardcoded `sleep(60)`. Store as `self._heartbeat_interval` set in `_heartbeat_start()` or `__init__`.
- **Files affected**:
  - `workflows/fiscal_agent/arca_extractor.py` (modify)
- **Dependencies**: T-07c-5 (heartbeat infrastructure exists)
- **Acceptance criteria**:
  - [ ] `ARCA_HEARTBEAT_INTERVAL=30` → heartbeat sleeps 30s between pings
  - [ ] Unset `ARCA_HEARTBEAT_INTERVAL` → defaults to 60s
  - [ ] Invalid value (e.g. `"abc"`) → logs warning and falls back to 60s default
  - [ ] `os.environ` is read on first access (not import time) — use `os.getenv()` at runtime
  - [ ] Spec-compliant: NFR-3 "SHOULD be configurable, default 60s"
- **Effort**: Small
- **Est. lines**: ~10 new

---

## Task Group 8: Fix Heartbeat Pause Busy-Wait

### T-07c-8: Replace busy-wait with asyncio.Event.wait() and invert set/clear

- **Name**: Fix heartbeat busy-wait to use proper event-driven await
- **Description**: Replace `while self._heartbeat_paused.is_set(): await asyncio.sleep(1)` with `await self._heartbeat_paused.wait()`. Invert the semantic so `set()` = heartbeat runs (wait returns) and `clear()` = heartbeat pauses (wait blocks). Swap `set()`/`clear()` calls in `run_all()` accordingly. Update `_heartbeat_start()` to call `.set()` so the fresh event starts in running state.
- **Files affected**:
  - `workflows/fiscal_agent/arca_extractor.py` (modify)
- **Dependencies**: T-07c-5 (heartbeat infrastructure)
- **Acceptance criteria**:
  - [ ] `while is_set(): sleep(1)` is replaced with `await _heartbeat_paused.wait()`
  - [ ] `_heartbeat_start()` calls `self._heartbeat_paused.set()` so heartbeat starts running immediately
  - [ ] `run_all()` calls `clear()` before switch (pauses heartbeat) and `set()` after (resumes heartbeat)
  - [ ] Design doc's documented approach ( `await self._heartbeat_paused.wait()` ) is matched exactly
  - [ ] No busy-wait in the heartbeat loop — fully event-driven
- **Effort**: Small
- **Est. lines**: ~5 changed

---

## Task Group 9: Pure Function Unit Tests

### T-07c-9: Test _es_error_2fa() and _es_error_credencial() pure functions

- **Name**: Unit tests for ARCA error classification functions
- **Description**: Create `workflows/tests/test_arca_extractor.py` with async test functions that import and test the module-level pure functions `_es_error_2fa()` and `_es_error_credencial()`. Match existing test patterns (async functions with `assert`, no pytest, manual `__main__` runner).
  - **`_es_error_2fa(exception)` tests**: strings containing `2fa`, `doble factor`, `two-factor`, `mfa`, `autenticacion de dos` → `True`. Non-matching strings → `False`.
  - **`_es_error_credencial(exception)` tests**: strings containing `credencial`, `invalid credentials`, `incorrect`, `clave incorrecta`, `login failed`, `usuario incorrecto`, `cuit incorrecto` → `True`. Non-matching strings → `False`.
- **Files affected**:
  - `workflows/tests/test_arca_extractor.py` (create)
- **Dependencies**: None (pure functions, no init needed)
- **Acceptance criteria**:
  - [ ] `_es_error_2fa(Exception("2fa challenge"))` → `True`
  - [ ] `_es_error_2fa(Exception("doble factor detectado"))` → `True`
  - [ ] `_es_error_2fa(Exception("random error"))` → `False`
  - [ ] `_es_error_2fa(Exception(""))` → `False`
  - [ ] `_es_error_credencial(Exception("credenciales invalidas"))` → `True`
  - [ ] `_es_error_credencial(Exception("invalid credentials"))` → `True`
  - [ ] `_es_error_credencial(Exception("clave incorrecta"))` → `True`
  - [ ] `_es_error_credencial(Exception("login failed"))` → `True`
  - [ ] `_es_error_credencial(Exception("cuit incorrecto"))` → `True`
  - [ ] `_es_error_credencial(Exception("random error"))` → `False`
  - [ ] `_es_error_credencial(Exception(""))` → `False`
  - [ ] All error keywords from the source function are covered
  - [ ] Matches existing test style (async function, `assert`, prints for pass/fail)
- **Effort**: Small
- **Est. lines**: ~50 new

---

## Task Group 10: Schema Validation Test

### T-07c-10: Test login_estudio.workflow.yaml loads without ValidationError

- **Name**: Schema validation test for login_estudio workflow YAML
- **Description**: Add a test in the same file (`test_arca_extractor.py`) that loads `login_estudio.workflow.yaml` via `WorkflowDefinitionSchema.load_from_file()` and asserts no `ValidationError` is raised. This directly validates T-07c-1 correctness and the `validate_ends_with_extract` constraint. Also test that `_load_workflow('login_estudio.workflow.yaml')` returns a valid `WorkflowDefinitionSchema` via a mock that bypasses async dependencies.
- **Files affected**:
  - `workflows/tests/test_arca_extractor.py` (modify — same file as T-07c-9)
- **Dependencies**: T-07c-1 (YAML fix must be applied), T-07c-3 (`_load_workflow` must exist)
- **Acceptance criteria**:
  - [ ] `WorkflowDefinitionSchema.load_from_file(yaml_path)` succeeds for `login_estudio.workflow.yaml`
  - [ ] Calling `_load_workflow('login_estudio.workflow.yaml')` returns a valid `WorkflowDefinitionSchema`
  - [ ] Test verifies spec REQ-7 scenario: "Given YAML with final step type extract, When WorkflowDefinitionSchema parses it, Then validation succeeds"
- **Effort**: Small
- **Est. lines**: ~30 new

---

## Dependencies Graph (Updated)

```
T-07c-1 ──────── (independent — YAML file only)
                      
T-07c-2 ─────────┐   (independent — refactor only)
T-07c-3 ─────────┤   (independent — new infrastructure)
                  │
                  ├─── T-07c-4 ─────── T-07c-5 ─────── T-07c-6
                  │    (workflow-     (heartbeat +     (session expiry
                  │     first         run_all/close     detection +
                  │     integration)   integration)     recovery)
                  │
T-07c-1 ─────────┘
         (optional dep: T-07c-4 needs the YAML to be valid)

--- Fix/Test tasks (can run in parallel with each other after predecessors) ---

T-07c-5 ─────── T-07c-7 ──────┐   (NFR-3: heartbeat interval config)
                  │           │
                  ├─ T-07c-8 ─┤   (fix: heartbeat busy-wait → event-driven)
                  │           │
T-07c-1 ───── T-07c-10 ──────┘   (schema validation test)
                              │
T-07c-9 (independent — pure function tests, no deps)
```

**Notes**:
- T-07c-7 and T-07c-8 both modify the heartbeat in `arca_extractor.py` — should be applied together or sequentially to avoid conflicts
- T-07c-9 and T-07c-10 go in the same file — T-07c-10 should come after T-07c-9 or be merged
- All fix/test tasks are independent of the main chain (T-07c-7 through T-07c-10 don't block T-07c-1→6)

---

## Next

**Ready for apply — including fix/test tasks**. Original 6 tasks plus 4 fix/test tasks bring the estimate to ~400 lines across 3 files (`arca_extractor.py`, `login_estudio.workflow.yaml`, `test_arca_extractor.py`).

The orchestrator should tell the user:
- The implementation is ~400 estimated lines across 3 files (at 400-line budget boundary)
- 10 sequential tasks, each completable in one session
- T-07c-7 and T-07c-8 are **fixes** from verification report — should be applied before or alongside existing tasks
- T-07c-9 and T-07c-10 are **tests** that prove spec compliance — should be applied after or alongside existing tasks
- `switch_representado.workflow.yaml` (T-07b recording) is a prerequisite — if it doesn't exist, the workflow-first switch will gracefully degrade to Agent fallback

**Apply order**: T-07c-1 → T-07c-2 → T-07c-3 → T-07c-4 → T-07c-5 → T-07c-6 → T-07c-7 → T-07c-8 → T-07c-9 → T-07c-10
