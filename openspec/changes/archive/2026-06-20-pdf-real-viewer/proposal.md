# Proposal: PDF Real Viewer

## Intent

Right column renders `result.reply` as HTML markdown — not the actual PDF. Users do the extraction wizard and get emoji-formatted text instead of a visual PDF preview. Additionally, the conversation history only stores the `reply` text, losing the full structured wizard result (steps, sections, data). We need both: inline PDF rendering in the right panel and rich conversation messages preserving the complete extraction output.

## Scope

### In Scope
- Replace `renderMarkdown(result.reply)` with real PDF inline viewer via `react-pdf`
- Add CDN-based PDF.js worker config
- Preserve "Descargar PDF" download button
- Pass full wizard result (steps, sections, elapsed, metadata) through `onWizardComplete`
- Store structured data as the assistant message content in conversation history
- Handle loading/error states for PDF rendering

### Out of Scope
- No backend or SSE data shape changes
- No PDF annotation, page navigation, or zoom controls
- No PDF generation — the backend already produces `result.pdf_url`
- No changes to wizard left-column flow

## Capabilities

### New Capabilities
- `pdf-inline-viewer`: Renders PDF from `result.pdf_url` inline in the right column using `react-pdf`. Loading, error, and empty states included.

### Modified Capabilities
- `inline-report-preview`: Requirement changes from "render `result.reply` as styled HTML" to "render PDF from `result.pdf_url` inline". HTML fallback kept for when `pdf_url` is absent.
- `chat-frontend`: `onWizardComplete` now passes structured wizard data (steps, sections, metadata) instead of just `reply` text. Assistant messages in conversation store the full extraction result.

## Approach

1. `npm install react-pdf` — add to dependencies
2. Configure PDF.js worker via CDN import (`pdfjs-dist/build/pdf.worker.min.mjs` URL)
3. Rewrite `ResultPanel.jsx`: conditionally render `<Document file={result.pdf_url}><Page/></Document>` when `pdf_url` is present; fall back to HTML markdown when absent
4. Handle `<Document>` `onLoadSuccess`/`onLoadError` for loading spinner and error state
5. Update `WizardOnboarding.jsx` `onWizardComplete(convId, reply, response, elapsedMs, stepsCount)` call to pass full `response` object — already does
6. Update `ChatPane.jsx` `handleWizardComplete` to forward structured data (already receives `fullResult`)
7. Update `useChat.js` `onWizardComplete` to store structured content instead of plain `reply` — include steps summary, sections, timestamps
8. Dockerfile: rebuild layer with `npm install` to include `react-pdf`

## Affected Areas

| Area | Impact | Change |
|------|--------|--------|
| `ResultPanel.jsx` | Modified | Replace `renderMarkdown` with `react-pdf` inline viewer |
| `ChatPane.jsx` | Modified | `handleWizardComplete` passes richer data to `onWizardComplete` |
| `WizardOnboarding.jsx` | No change needed | Already passes full `response` object |
| `useChat.js` | Modified | Store structured result in assistant message `content` |
| `package.json` | Modified | Add `react-pdf` dependency |
| Docker layer | Rebuild | `npm install` picks up new dependency |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `react-pdf` worker CDN URL changes | Low | Pin exact version; fallback to HTML markdown |
| PDF CORS (cross-origin) | Medium | Serve PDF from same origin or proxy; configure CORS headers |
| Large PDF rendering performance | Low | Render first page only; worker runs off main thread |
| `react-pdf` React 19 compatibility | Low | Verify peer deps; `react-pdf` v9+ supports React 19 |

## Rollback Plan

Revert `ResultPanel.jsx`, `ChatPane.jsx`, `useChat.js`, `package.json`. Remove `react-pdf` from `node_modules` and rebuild. One-commit revert, no data migration.

## Dependencies

- `react-pdf` (npm) — wraps PDF.js for React
- PDF.js worker — loaded from CDN via `pdf.workerSrc` config
- Backend PDF endpoint must serve with permissive CORS or same-origin

## Success Criteria

- [ ] Right column renders PDF inline from `result.pdf_url` using `<Document>`/`<Page>`, not HTML markdown
- [ ] Loading spinner shown while PDF loads; error message if PDF fails
- [ ] "Descargar PDF" button still works and opens PDF in new tab
- [ ] Conversation history shows full structured wizard result (not just `reply` text)
- [ ] No regressions in wizard flow, left-column behavior, or existing conversations
- [ ] New `pdf-inline-viewer` capability spec created in `openspec/specs/`
- [ ] `inline-report-preview` spec updated with delta for PDF-first rendering
