# Proposal: T-07 Workflow Browser Synchronization

## Intent

ARCA's auth session expires after ~4 minutes of inactivity. The current `ArcaExtractor.run_all()` creates a single Browser via lazy-init and shares it — but the planned T-07c integration loads YAML workflow files via `Workflow()`, which will create a **new** Browser per workflow file unless explicitly prevented. Each new Browser loses the auth session, making login+switch pointless. This proposal solves that: keep one browser, share it across all workflow executions, close it at the end. Without this, the entire ARCA extraction pipeline breaks.

## Scope

### In Scope
- **Browser sync**: Share one `Browser` instance across all `Workflow()` executions inside `ArcaExtractor`
- **Session management**: Keep session alive across login → switch → (future) extract with `close_browser_at_end=False` and a heartbeat mechanism
- **Workflow-First refactor**: `login()` and `switch_representado()` load recorded YAML workflows first, fall back to Agent on failure
- **Fix login_estudio schema**: Change final `validate` step to `extract` to pass `validate_ends_with_extract` validator
- **ARCA error scenarios**: Handle 2FA, invalid credentials, portal down, session expiry mid-scrape via workflow execution errors
- **Agent fallback**: When workflow execution fails, fall back to existing Agent-based `_login_with_agent()` and `_switch_with_agent()`

### Out of Scope
- **T-08**: `extract_deuda.workflow.yaml` creation and `extraer_deuda()` implementation
- **T-09**: Matching module (deuda × calendario)
- **T-10**: PDF import column population
- Any Page 3 / PDF changes

## Capabilities

### New Capabilities
- `arca-browser-sync`: Shared browser lifecycle management for ARCA workflow execution. Each `ArcaExtractor` instance owns one Playwright/Browser, passes it to every `Workflow()` call, and closes it on `close()`.

### Modified Capabilities
- None — no existing specs. This is the first capability spec.

## Approach

**Pattern**: ArcaExtractor owns browser lifecycle → passes to Workflow → Workflow runs with `close_browser_at_end=False` → ArcaExtractor closes.

### Core changes in `arca_extractor.py`

1. **Keep `_get_browser()`** — already lazy-inits a single `Browser` instance. No change needed.

2. **Add `_load_workflow(filename)`** — resolves path relative to `fiscal_agent/workflows/arca/`, loads YAML, returns `WorkflowDefinitionSchema`.

3. **Add `_run_workflow(workflow_schema, inputs)`** — creates `Workflow(workflow_schema, llm=self._llm, browser=self._browser)`, calls `await workflow.run(inputs, close_browser_at_end=False)`.

4. **Refactor `login()`**:
   - Try `_run_workflow('login_estudio.workflow.yaml', {cuit, clave_fiscal})`
   - On success → set `_authenticated=True`, return True
   - On `WorkflowExecutionError` → log warning → fallback to existing Agent logic (extracted as `_login_with_agent()`)

5. **Add `switch_representado()` workflow variant**:
   - Try `_run_workflow('switch_representado.workflow.yaml', {target_cuit})`
   - On success → set `_current_cuit`, return True
   - On failure → fallback to Agent

6. **Session keep-alive**: Add `_heartbeat()` that navigates to a benign ARCA page or interacts with a non-critical element every 60s during idle periods between workflow executions. Start after login, stop on `close()`.

7. **Fix login_estudio.workflow.yaml**: Replace `validate` step (id: `validate_authenticated`, type: `validate`) with `extract` step that outputs `{authenticated: true, study_cuit: "{{cuit}}"}`.

### Workflow execution flow

```
ArcaExtractor._get_browser()  →  single Browser (lazy init)
         │
         ├─ login()
         │    ├─ Workflow('login_estudio').run(close_browser_at_end=False)
         │    │    └─ uses existing Browser → keeps session
         │    └─ fallback: Agent with same Browser
         │
         ├─ switch_representado(cuit)
         │    ├─ Workflow('switch_representado').run(close_browser_at_end=False)
         │    │    └─ uses same Browser → session preserved
         │    └─ fallback: Agent with same Browser
         │
         └─ close() → self._browser.close()
```

### login_estudio workflow fix

Current last step:
```yaml
- id: "validate_authenticated"
  description: "Validate that login was successful"
  type: "validate"
  expect_text: ["Mis Impuestos", "Mis Obligaciones", "Bienvenido"]
  timeout_ms: 5000
```

Replace with:
```yaml
- id: "extract_auth_result"
  description: "Extract authentication result"
  type: "extract"
  extractionGoal: "Determine if login was successful. Look for 'Mis Impuestos', 'Mis Obligaciones', or 'Bienvenido' in the page. Return JSON: {authenticated: bool, study_cuit: string}."
```

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `fiscal_agent/arca_extractor.py` | Modified | Add `_load_workflow`, `_run_workflow`, `_heartbeat`, workflow-first login/switch, Agent fallback extraction |
| `fiscal_agent/workflows/arca/login_estudio.workflow.yaml` | Modified | Fix final step: `validate` → `extract` |
| `fiscal_agent/workflows/arca/switch_representado.workflow.yaml` | New | Create switch workflow file (T-07b) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Workflow schema rejects changes if `validate_ends_with_extract` is stricter than expected | Low | Already confirmed: validator checks `step_type in ['extract', 'extract_page_content']` — the `extract` type matches |
| Session expires between workflow executions despite `close_browser_at_end=False` | Medium | Heartbeat every 60s; detect expiry via URL check and trigger re-login |
| Workflow YAML has semantic steps that don't match the schema fields | Medium | `WorkflowDefinitionSchema` Pydantic model will validate on load — errors caught early, fallback to Agent |
| `close_browser_at_end=False` leaks browser if exception occurs mid-run | Low | `finally` block in `ArcaExtractor.run_all()` calls `self.close()` regardless of success |

## ARCA-Specific Considerations

- **Session expiry (4 min)**: Heartbeat pings a non-critical page element every 60s. Detected expiry triggers re-login + retry from switch.
- **Page redirects**: ARCA redirects from landing → login → post-login dashboard. Workflows capture these as sequential `navigation` steps. Agent fallback handles unexpected redirects.
- **Dynamic DOM**: CUIT input loads after page ready. Workflow steps include explicit waits. CSS selectors (`input[placeholder="CUIT"]`) used over index-based.
- **2FA (ARCA-6)**: Detected by text matching in error/step output. Workflow execution catches it; Agent fallback also detects and reports. No retry — log and skip.
- **Invalid credentials (ARCA-4)**: Workflow will fail at login step. Detected by error text matching. No retry.
- **Portal down (ARCA-5)**: Catches timeout/connection errors. Retry 3× with backoff (5s/15s/45s) via existing `RETRY_DELAYS`.

## Execution Model

```
run_all(clientes):
  1. browser = _get_browser()
  2. login_ok = await login()
     - workflow=login_estudio → fallback=Agent
  3. if not login_ok: return all-error results
  4. start heartbeat task
  5. for each cliente:
       a. switch_ok = await switch_representado(cliente.cuit)
          - workflow=switch → fallback=Agent
       b. if not switch_ok: append error, continue
       c. (future T-08) await extraer_deuda()
  6. stop heartbeat
  7. await close()  # always runs, even on error
```

## Risk Mitigation

| Issue | How We Handle It |
|-------|------------------|
| Workflow schema doesn't accept our YAML | Pydantic catches on `_load_workflow()`, exception propagated to caller → fallback to Agent |
| Session expired between workflows | Heartbeat detects; `_detect_session()` checks current URL. If on login page → re-login → retry current operation |
| 2FA suddenly appears mid-session | Workflow execution fails with identifiable error → Agent fallback detects 2FA → log and skip |
| Redirect to unexpected page | Workflow `navigation` steps are sequential; if wrong page appears, the step fails → fallback to Agent which adapts |

## Rollback Plan

**If `close_browser_at_end=False` causes browser leaks or resource exhaustion**:
1. Revert `arca_extractor.py` to pre-T-07c state (restore original `login()` and `switch_representado()` — Agent-based only)
2. Keep `login_estudio.workflow.yaml` fix (the `validate` → `extract` schema fix is harmless alone)
3. Delete `switch_representado.workflow.yaml` if created
4. Diagnostic: run `test_keep_alive` with headed mode to confirm browser lifecycle

**If schema fix breaks existing tests**:
1. Revert just the YAML change
2. Keep code changes but leave workflow files as-is
3. Investigate schema validator for backward compatibility

## Dependencies

- `fiscal_agent/workflows/arca/switch_representado.workflow.yaml` must exist (T-07b — recording task)
- `workflow_use/workflow/service.py` must support `close_browser_at_end` param (already does, confirmed from source)
- `workflow_use/schema/views.py` `validate_ends_with_extract` validator must accept `extract` type (already does)

## Success Criteria

- [ ] `login()` runs `login_estudio.workflow.yaml` first, falls back to Agent on failure
- [ ] `switch_representado()` runs `switch_representado.workflow.yaml` first, falls back to Agent on failure
- [ ] Same browser session across both workflow executions (verify: no new CDP session created)
- [ ] `login_estudio.workflow.yaml` loads without schema validation error
- [ ] `close_browser_at_end=False` prevents browser from being closed between workflows
- [ ] `close()` properly cleans up browser regardless of success/failure path
- [ ] Session heartbeat fires every 60s (or configured interval)
- [ ] All ARCA error scenarios (2FA, bad creds, portal down) produce correct logs and skip behavior
