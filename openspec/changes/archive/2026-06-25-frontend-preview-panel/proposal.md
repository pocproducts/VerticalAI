# Proposal: Frontend Preview Panel

## Intent

Wire ResultPanel (right column) to show extraction progress and final report from **both** flows: wizard **and** direct chat messages. Currently, the right column only activates from the wizard flow — direct messages like "extraer CUIT 20-32456789-2" leave it empty.

## Scope

### In Scope
1. Expose `latestResult` + `latestPipelineSteps` from `useChat` hook
2. Wire direct message flow's progress steps into ResultPanel in real-time (during extraction)
3. Show final report in ResultPanel after extraction completes
4. Keep left column CLI-style pipeline progress during extraction (already works)
5. Wizard flow continues working unchanged

### Out of Scope
- Backend changes (API already sends SSE progress)
- New UI components (ResultPanel, Message already exist)
- Mobile responsive improvements for ResultPanel
- PDF viewer improvements

## Capabilities

### New Capabilities
None — wiring existing capabilities, no new spec-level behavior.

### Modified Capabilities
None — pure implementation change, no spec-level requirement changes.

## Approach

Three-file change, pure frontend wiring:

1. **`hooks/useChat.js`**: Add `latestResult` (tracking `response.reply` shape) and `latestPipelineSteps` state. In `sendMessage`: clear on start, set on SSE completion (from `response.reply` + `stepsRef.current`). Export both from the hook.

2. **`components/AIAssistantUI.jsx`**: Destructure new values from `useChat()`, pass them to `ChatPane`.

3. **`components/ChatPane.jsx`**: Accept new props. When direct message flow produces data (`latestResult` non-null or extraction in progress), pass it to ResultPanel alongside wizard data. Use `loading` for real-time progress indication. Keep existing wizard state as-is.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `hooks/useChat.js` | Modified | Add `latestResult` + `latestPipelineSteps` state and exports |
| `components/AIAssistantUI.jsx` | Modified | Pass new hook exports to ChatPane |
| `components/ChatPane.jsx` | Modified | Accept new props, feed them to ResultPanel |

No changes to `ResultPanel.jsx` — it already accepts the data shape it needs.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Race between progressSteps and final result | Low | Use `stepsRef.current` (already exists) for final snapshot |
| Wizard flow regression | Low | Wizard state flows unchanged — new props are additive |
| ResultPanel shows stale data between conversations | Low | Clear `latestResult` on new sendMessage |

## Rollback Plan

Revert the 3 modified files. No schema, API, or data model changes — pure JS state wiring.

## Dependencies

None.

## Success Criteria

- [ ] Sending "extraer CUIT 20-32456789-2" shows pipeline steps in ResultPanel in real-time
- [ ] After extraction completes, ResultPanel shows structured report with section cards
- [ ] Wizard flow continues working identically (right column, left column, message rendering)
- [ ] Left column shows CLI-style pipeline progress during extraction (unchanged)
