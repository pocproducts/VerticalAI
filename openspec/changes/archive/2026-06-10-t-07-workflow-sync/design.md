# Design: T-07 Workflow Browser Synchronization

## Technical Approach

**Single-browser lifecycle owned by `ArcaExtractor`**: share one `Browser` across all workflow executions via `close_browser_at_end=False`, add a background heartbeat to prevent ARCA's 4-min session expiry, and adopt a Workflow-First pattern (try YAML, fall back to Agent). The login workflow file gets a schema-compliant final `extract` step.

## Architecture Decisions

### Decision: Browser Ownership

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `ArcaExtractor` owns browser, passes to `Workflow()` | Keeps session; only one `.close()` point | ✅ **Chosen** |
| Each `Workflow()` creates own browser | Session lost between files; auth must repeat | ❌ Rejected |
| Browser registry / singleton | Over-engineered for single-extractor scope | ❌ Rejected |

### Decision: Workflow-First + Agent Fallback

| Option | Tradeoff | Decision |
|--------|----------|----------|
| Try YAML first, catch error, fall back to Agent | Resilient; uses recordings when they work | ✅ **Chosen** |
| Workflow only, no fallback | Brittle; YAML drift breaks the pipeline | ❌ Rejected |
| Agent only (current state) | Ignores T-07b/c value; no determinism | ❌ Rejected |

### Decision: Background Heartbeat via `fetch()`

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `page.evaluate("fetch(...)")` | Cookie-bearing, zero navigation, non-disruptive | ✅ **Chosen** |
| Navigate to benign page | Disrupts current workflow state | ❌ Rejected |
| Open separate tab | Tab leaks; harder to clean up | ❌ Rejected |

### Decision: Error Propagation from Workflow

`Workflow.run()` raises `ValueError` on step failure (no custom exception in codebase). Catch `ValueError` (and any other `Exception`) in `_run_workflow()`, log, and let the caller decide fallback. No custom exception needed — the Agent fallback is the error handler.

## Data Flow

```
CLI.run()
  │
  └─ ArcaExtractor.run_all(clientes)
       │
       ├── _get_browser()                    Browser (lazy, singleton)
       │
       ├── login()
       │    ├── _run_workflow('login_estudio') → Workflow(schema, llm, browser)
       │    │    └── Workflow.run(inputs, close_browser_at_end=False)
       │    │         └── steps execute on shared Browser
       │    └── (on failure) _login_with_agent() → Agent(task, llm, browser)
       │
       ├── _heartbeat_task = asyncio.create_task(_heartbeat())
       │    └── page.evaluate("fetch('/contribuyente_/')") every 60s
       │
       ├── for each cliente:
       │    ├── _heartbeat_paused.set()
       │    ├── switch_representado(cuit)
       │    │    ├── _run_workflow('switch_representado') → Workflow(schema, llm, browser)
       │    │    └── (on failure) _switch_with_agent()
       │    ├── _heartbeat_paused.clear()
       │    └── (T-08) extraer_deuda()
       │
       └── close()  [finally block]
            ├── _heartbeat_active = False
            ├── _browser.close()
            └── reset state flags
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `fiscal_agent/arca_extractor.py` | Modify | Add workflow loading, workflow-first login/switch, heartbeat, refactor Agent into `_*_with_agent()` methods |
| `fiscal_agent/workflows/arca/login_estudio.workflow.yaml` | Modify | Fix last step: `validate` → `extract` to pass `validate_ends_with_extract` |
| `fiscal_agent/workflows/arca/switch_representado.workflow.yaml` | Create | T-07b recording task — referenced but NOT created by this change |

## Module Changes (`arca_extractor.py`)

### New Methods

| Method | Signature | Role |
|--------|-----------|------|
| `_load_workflow` | `(filename: str) -> WorkflowDefinitionSchema` | Load YAML relative to `workflows/arca/`, parse via Pydantic |
| `_run_workflow` | `(schema, inputs) -> bool` | Instantiate `Workflow(schema, llm=self._llm, browser=self._browser)`, call `.run(inputs, close_browser_at_end=False)`, catch errors |
| `_heartbeat` | `() -> None` (async task) | Background loop: `while active: page.evaluate(fetch); sleep 60` |
| `_login_with_agent` | `() -> bool` | Extract current Agent-based login logic (lines 141-204) into its own method |
| `_login_with_workflow` | `() -> bool` | Try `_run_workflow('login_estudio', {cuit, clave_fiscal})` |
| `_switch_with_agent` | `(cuit: str) -> bool` | Extract current Agent-based switch logic (lines 206-244) into its own method |
| `_switch_with_workflow` | `(cuit: str) -> bool` | Try `_run_workflow('switch_representado', {target_cuit: cuit})` |

### Modified Methods

| Method | Change |
|--------|--------|
| `login()` | Call `_login_with_workflow()` first; on failure → `_login_with_agent()`. Apply existing ARCA error handling (2FA, bad creds skip; portal down retry 3×) to both paths. |
| `switch_representado(cuit)` | Call `_switch_with_workflow(cuit)` first; on failure → `_switch_with_agent(cuit)` |
| `run_all(clientes)` | Add: heartbeat start after login, heartbeat pause/resume per client, `finally` block for `close()` |
| `close()` | Add: stop heartbeat (`_heartbeat_active = False`) before closing browser |

### New State

```python
self._heartbeat_active: bool = False       # Guard for heartbeat loop
self._heartbeat_paused: asyncio.Event = asyncio.Event()  # Pause during workflow steps
self._heartbeat_task: Optional[asyncio.Task] = None       # Reference for cancellation
```

## Heartbeat Strategy

**Mechanism**: After login succeeds, start an asyncio background task that:
1. Checks `_heartbeat_active` (stops if False)
2. Waits for `_heartbeat_paused` to be clear (blocks during workflow execution)
3. Gets current page via `self._browser.get_current_page()`
4. Calls `page.evaluate("fetch('/contribuyente_/', {method: 'HEAD'})")` — same-origin request carries session cookies, does not navigate
5. On success: `logger.debug('Heartbeat OK')`
6. On failure: `logger.warning` (session may have expired; caller should detect and re-login)
7. `await asyncio.sleep(60)`

**Lifecycle**: start after `login()` in `run_all()`, pause before each workflow run, resume after, stop in `close()`.

**Error tolerance**: heartbeat failures are non-fatal — they just log. If the session actually expired, `_detect_session()` checking the current URL will catch it before the next operation.

```python
async def _heartbeat(self):
    """Send keep-alive pings to prevent ARCA session expiry."""
    while self._heartbeat_active:
        await self._heartbeat_paused.wait()
        try:
            page = await self._browser.get_current_page()
            await page.evaluate("fetch('/contribuyente_/', {method: 'HEAD'})")
        except Exception as exc:
            logger.warning('Heartbeat ping failed: %s', exc)
        await asyncio.sleep(60)
```

## Error Handling

| Error | Detection | Action | Retry? |
|-------|-----------|--------|--------|
| **Invalid credentials (ARCA-4)** | `_es_error_credencial(exc)` on Agent path; workflow `step` failure text | Log error, return False | No |
| **Portal down (ARCA-5)** | `ValueError` or connection error | Retry 3×: 5s/15s/45s via existing `RETRY_DELAYS` | Yes |
| **2FA challenge (ARCA-6)** | `_es_error_2fa(exc)` on Agent path; workflow step failure text containing "2FA" | Log warning, return False | No |
| **Workflow schema validation** | Pydantic `ValidationError` on `_load_workflow()` | Log, fallback to Agent | No (broken file) |
| **Workflow step failure** | `ValueError` from `Workflow.run()` | Log step + error, fallback to Agent for the operation | No (per operation) |
| **Session expired mid-pipeline** | URL check before next workflow run → detects login page | Re-login via `login()` → retry current operation | Yes |

Session expiry detection is implicit: before each workflow run, check `page.url()` after a short wait. If it resolves to `auth.afip.gob.ar/login*`, the session is gone. Trigger `_login_with_agent()` as recovery (faster than full workflow).

Workflow failure vs Agent fallback: failure in a workflow step is a normal path (status quo = Agent). The workflow path is an optimization — when it fails, we degrade gracefully.

## Workflow File Fix (`login_estudio.workflow.yaml`)

Replace final `validate` step (lines 66-70) with:

```yaml
- id: "extract_auth_result"
  description: "Extract authentication result"
  type: "extract"
  extractionGoal: >
    Determine if login was successful. Look for 'Mis Impuestos',
    'Mis Obligaciones', or 'Bienvenido' in the page. Return JSON:
    {authenticated: bool, study_cuit: string}.
```

This satisfies `validate_ends_with_extract` (checks `step_type in ['extract', 'extract_page_content']`). Keeps `input_schema` and `output_schema` unchanged.

## Sequence Diagram

```
CLI                 ArcaExtractor          Browser        Workflow         Agent
 │                        │                   │              │               │
 │  run_all(clientes)     │                   │              │               │
 │───────────────────────►│                   │              │               │
 │                        │  _get_browser()   │              │               │
 │                        │──────────────────►│  lazy init   │               │
 │                        │◄──────────────────│              │               │
 │                        │                   │              │               │
 │                        │  login()          │              │               │
 │                        │  _login_with_workflow()         │               │
 │                        │────────────────────────────────►│               │
 │                        │  _load_workflow()  │              │               │
 │                        │◄──────────────────│              │               │
 │                        │  Workflow.run(    │              │               │
 │                        │   close=False)    │─────────────►│               │
 │                        │                   │  steps exec  │               │
 │                        │◄─────────────────────────────────│               │
 │                        │                   │              │               │
 │     (on failure)       │  _login_with_agent()             │               │
 │                        │──────────────────────────────────────────────►  │
 │                        │                   │              │               │
 │                        │  start heartbeat  │              │               │
 │                        │                   │◄── fetch()  │               │
 │                        │                   │    every 60s│               │
 │                        │                   │              │               │
 │  for each cliente:     │                   │              │               │
 │                        │  pause heartbeat  │              │               │
 │                        │  switch_rep(cuit) │              │               │
 │                        │  _switch_with_workflow()        │               │
 │                        │────────────────────────────────►│               │
 │                        │◄─────────────────────────────────│               │
 │     (on failure)       │  _switch_with_agent()            │               │
 │                        │──────────────────────────────────────────────►  │
 │                        │  resume heartbeat │              │               │
 │                        │                   │              │               │
 │                        │  close() [finally]│              │               │
 │◄───────────────────────┤  stop heartbeat   │              │               │
 │                        │──────────────────►│  close()     │               │
 │                        │◄──────────────────│              │               │
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | `_load_workflow()` with valid/invalid YAML | Test with fixture files; expect `WorkflowDefinitionSchema` or `ValidationError` |
| Unit | `_run_workflow()` return on success/failure | Mock `Workflow.run()` to return normally / raise `ValueError` |
| Integration | Browser sharing: same browser instance across calls | Assert `id(self._browser)` is identical before/after workflow run |
| Integration | Heartbeat start/stop lifecycle | Start task, verify `page.evaluate` called with `fetch`, stop, verify loop ends |
| E2E | Full `run_all()` with mock auth workflow | Inject test workflow YAML, verify login → switch flow without real ARCA |
| Schema | `login_estudio.workflow.yaml` after fix | Load with `WorkflowDefinitionSchema(**yaml_data)`, assert no validation error |

## Open Questions

- **Heartbeat URL path**: `/contribuyente_/` is a guess. Must be confirmed against actual ARCA session behavior. Fallback: try `/` (landing) or a known GET endpoint. Swimlane shows placeholder — update during apply.
- **switch_representado.workflow.yaml**: does not exist yet. The `_switch_with_workflow()` call will fail gracefully (file not found → caught by `_load_workflow` → fallback to Agent) until T-07b recording completes.
- **Session expiry recovery**: `_detect_session()` needs concrete URL logic. Proposal mentions it but details depend on post-login page structure observed during T-07b recording.

## Next

Ready for tasks (sdd-tasks).

**OpenSpec**: `openspec/changes/t-07-workflow-sync/design.md`
**Engram**: `sdd/t-07-workflow-sync/design`
