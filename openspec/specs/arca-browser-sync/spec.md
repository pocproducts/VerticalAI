> **SUPERSEDED** — This spec is replaced by `composio-browser-integration` (change `composio-browser-provider`). See `openspec/specs/composio-browser-integration/spec.md` for the current source of truth.
>
> Archived: 2026-06-10

# arca-browser-sync Specification

## Purpose

Shared browser lifecycle for ARCA extraction. `ArcaExtractor` owns one Playwright Browser, passes it to workflow YAML files, and keeps the session alive across login → switch → extract stages.

## Requirements

### REQ-1: Browser Ownership — Single Instance

The system MUST own one Browser per `ArcaExtractor` lifecycle. The browser MUST be lazy-initialized on first `_get_browser()` call and MUST NOT be replaced between workflow executions.

#### Scenario: Shared browser across workflows

- GIVEN an `ArcaExtractor` with `_get_browser()` called
- WHEN `login()` then `switch_representado()` execute
- THEN both use the same Browser instance
- THEN `close()` releases it exactly once

### REQ-2: Workflow Receives External Browser

`Workflow()` MUST accept a `browser` parameter. `run()` MUST support `close_browser_at_end=False` to keep the browser alive.

#### Scenario: Browser persists across runs

- GIVEN a `Workflow(..., browser=self._browser)`
- WHEN `workflow.run(inputs, close_browser_at_end=False)` completes
- THEN the Browser remains open

### REQ-3: Workflow-First Execution

Each operation SHOULD load its workflow YAML first via `_load_workflow()`. On `WorkflowExecutionError`, the system MUST fall back to Agent with the same Browser.

#### Scenario: Workflow succeeds

- GIVEN valid `login_estudio.workflow.yaml`
- WHEN `login()` executes workflow
- THEN `_authenticated` is set to `True`

#### Scenario: Workflow fails → Agent fallback

- GIVEN a broken workflow file
- WHEN `login()` executes and workflow raises
- THEN Agent fallback runs with the same Browser
- THEN on Agent success, `_authenticated = True`

### REQ-4: Session Heartbeat

The system SHOULD run a cancellable background task interacting with ARCA every 60s during client processing to prevent the 4-min session expiry.

#### Scenario: Heartbeat prevents expiry

- GIVEN an authenticated session
- WHEN processing clients takes >2 minutes
- THEN heartbeat fires every 60s
- THEN the session stays valid

### REQ-5: ARCA Error Handling

The system MUST detect these errors with distinct behavior:

| Error | Detection | Action |
|-------|-----------|--------|
| ARCA-4 (bad creds) | Error text match | Log, skip, no retry |
| ARCA-5 (portal down) | Timeout/connection error | Retry 3× at 5s/15s/45s, then skip |
| ARCA-6 (2FA) | Error text match | Log, skip, no retry |
| Session expiry | URL/state check | Re-login, retry operation |

#### Scenario: Invalid credentials (ARCA-4)

- GIVEN invalid creds
- WHEN `login()` detects ARCA-4
- THEN log and return `False`, no retry

#### Scenario: Portal down (ARCA-5)

- GIVEN ARCA unreachable
- WHEN `login()` times out
- THEN retry at 5s, 15s, 45s
- THEN if all fail, log and return `False`

#### Scenario: 2FA challenge (ARCA-6)

- GIVEN 2FA page appears
- WHEN workflow/Agent detects it
- THEN log and return `False`, no retry

#### Scenario: Session expired mid-processing

- GIVEN session expires between clients
- WHEN heartbeat or next operation detects lost session
- THEN re-execute `login()`, retry the failed client

### REQ-6: Always Clean Up

The system MUST call `close()` in a `finally` block in `run_all()`. `close()` MUST be safe to call when `_browser` is `None`.

#### Scenario: Cleanup on success

- GIVEN all clients done
- WHEN `run_all()` completes
- THEN `close()` runs, Browser is closed

#### Scenario: Cleanup on error

- GIVEN exception mid-pipeline
- WHEN `finally` executes
- THEN `close()` runs, Browser is closed

### REQ-7: login_estudio Last Step

The YAML's last step MUST be type `extract` (not `validate`) to pass `validate_ends_with_extract`.

#### Scenario: Schema validation

- GIVEN YAML with final step type `extract`
- WHEN `WorkflowDefinitionSchema` parses it
- THEN validation succeeds

### REQ-8: Continue on Client Failure

A single client failure MUST NOT stop remaining clients. The system appends an error result and continues.

#### Scenario: Partial failure

- GIVEN 5 clients
- WHEN client 3 switch fails
- THEN error recorded, processing continues with 4 and 5
- THEN result has 5 entries, 1 with error

## Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1 | Workflow latency | SHOULD complete <5s per file |
| NFR-2 | Agent fallback latency | SHOULD complete <30s |
| NFR-3 | Heartbeat interval | SHOULD be configurable, default 60s |
| NFR-4 | Error classification | MUST log error code (ARCA-4/5/6) |
| NFR-5 | No browser leaks | MUST NOT leave orphan processes after `close()` |

## Data Contracts

| Stage | Input | Output |
|-------|-------|--------|
| `login_estudio.workflow` | `cuit`, `clave_fiscal` | `{authenticated: bool, study_cuit: string}` |
| `switch_representado.workflow` | `target_cuit` | `{switched: bool, current_cuit: string}` |
