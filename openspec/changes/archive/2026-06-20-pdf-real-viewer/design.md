# Design: PDF Real Viewer

## Technical Approach

Replace markdown-rendered text in the right column with an inline PDF viewer using `react-pdf` (Part A), and pass full wizard processing history through the component chain so the conversation message shows a rich result card instead of plain text (Part B). Both parts are independent in code but share the same trigger (wizard completion) and data source (`response` + `progressSteps`).

---

## Architecture Decisions

### Decision: PDF renderer library

| Option | Tradeoff | Decision |
|--------|----------|----------|
| `react-pdf` | Mature, wraps PDF.js, React 19 compatible (v9+) | **Chosen** |
| `@react-pdf-viewer/core` | Richer UI (toolbar, zoom) but heavier bundle | Rejected — out of scope per proposal |
| Raw PDF.js | More control but manual React integration | Rejected — reinvents `react-pdf` |

### Decision: PDF.js worker source

**Choice**: CDN via `unpkg.com/pdfjs-dist@4.x/build/pdf.worker.min.mjs`  
**Alternatives**: Bundle worker with webpack/next — adds ~2MB to JS bundle  
**Rationale**: Worker runs off-main-thread; CDN avoids bundle bloat. Pinned version prevents breakage.

### Decision: react-pdf import strategy

**Choice**: `next/dynamic(() => import("react-pdf"), { ssr: false })`  
**Alternatives**: Import at module level — crashes SSR because PDF.js needs `window`  
**Rationale**: Dynamic import scopes the window-dependent code to client-side only.

### Decision: Steps data propagation (Option A)

**Choice**: Pass `progressSteps` array (not just `.length`) through `onWizardComplete`  
**Alternatives**:  
- B: Backend includes steps in response — requires backend changes, out of scope  
- C: Reconstruct steps from `response.reply` — lossy, can't recover step timings/statuses  
**Rationale**: Steps are already in WizardOnboarding's state. Pass as extra arg. No backend changes.

### Decision: Message data model for rich results

**Choice**: Add `wizardData` field to assistant message (keep `content` as plain reply text)  
**Alternatives**: Replace `content` with structured object — breaks rendering of existing messages  
**Rationale**: Existing messages have `content: string`. Adding `wizardData` as optional field maintains backward compatibility — Message.jsx checks `m.wizardData` to decide render path.

---

## Data Flow

```
Part A — Right Column PDF
  WizardOnboarding
    ↓ onWizardComplete(convId, reply, response, elapsedMs, stepsCount)
  ChatPane.handleWizardComplete
    ↓ setWizardResult({ reply, pdf_url })
  ResultPanel (receives result prop)
    ├─ no result → grey placeholder
    ├─ has pdf_url → react-pdf <Document file={pdf_url}>
    │   ├─ loading → spinner + download button
    │   ├─ success → <Page> for each page (scrollable) + download button
    │   └─ error → error message + download button
    └─ no pdf_url → renderMarkdown(result.reply) fallback

Part B — Rich Conversation Message
  WizardOnboarding
    ↓ onWizardComplete(convId, reply, response, elapsedMs, stepsCount, progressSteps)
  ChatPane.handleWizardComplete
    ↓ onWizardComplete(convId, reply, { steps: progressSteps, elapsedMs, sections })
  useChat.onWizardComplete
    ↓ stores { content: reply, wizardData: { steps, elapsedMs, sections, pdf_url } }
  Message.jsx
    ├─ has wizardData → rich card (status header, steps list, elapsed time, sections, download link)
    └─ no wizardData → existing markdown render (backward compat)
```

---

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `package.json` | Modify | Add `react-pdf` dependency |
| `components/ResultPanel.jsx` | Modify | Replace markdown render with `react-pdf` `<Document>`/`<Page>`; add loading/error states; keep HTML fallback when `pdf_url` absent |
| `components/ChatPane.jsx` | Modify | `handleWizardComplete`: extract `progressSteps` from 6th arg; pass `wizardData` to `onWizardComplete` |
| `hooks/useChat.js` | Modify | `onWizardComplete`: accept `wizardData` param; store on assistant message as `{ content, wizardData }` |
| `components/Message.jsx` | Modify | If message has `wizardData`, render rich result card (steps, elapsed, sections, download link); else render children as before |

---

## react-pdf Configuration

```js
// In ResultPanel.jsx — worker config must run once before <Document> renders
import { pdfjs } from "react-pdf"
pdfjs.GlobalWorkerOptions.workerSrc =
  "//unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs"

// Dynamic import (no SSR)
import dynamic from "next/dynamic"
const { Document, Page } = dynamic(
  () => import("react-pdf").then((mod) => ({ Document: mod.Document, Page: mod.Page })),
  { ssr: false },
)
```

Layout rendering all pages:
```jsx
<Document file={result.pdf_url} onLoadError={...} onLoadSuccess={...}>
  {Array.from({ length: numPages }, (_, i) => (
    <Page key={i} pageNumber={i + 1} />
  ))}
</Document>
```

---

## Interfaces / Contracts

```js
// New field on assistant message
{
  id: "a1b2c3",
  role: "assistant",
  content: "reply text...",                        // unchanged for backward compat
  wizardData: {                                     // optional, only for wizard results
    steps: [{ message: "Consultando AFIP...", status: "done" }, ...],
    elapsedMs: 12340,
    sections: ["Deuda", "Registro", "IIBB"],       // parsed from reply headings
    pdf_url: "https://.../reporte.pdf",             // optional
  },
  createdAt: "2026-06-21T..."
}
```

---

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Manual | PDF renders correctly in right column | Load wizard, verify PDF appears with "Descargar PDF" |
| Manual | Loading/error states | Disconnect network mid-load, verify fallback |
| Manual | Multi-page PDF scroll | Use a PDF with 3+ pages, verify scrolling |
| Manual | Rich conversation message | Complete wizard, verify the message shows steps + sections |
| Manual | Backward compat | Load an existing conversation, verify old messages render as plain text |

No unit tests — the frontend has no test runner configured (config.yaml confirms `strict_tdd: false`, no test command for frontend).

---

## Migration / Rollout

No migration required. Existing conversations render unchanged (backward-compat `wizardData` field). Deploy with a `npm install` rebuild — Docker picks up `react-pdf` automatically.

---

## Open Questions

- [ ] Does the backend `response` object include structured sections data, or do we parse `##` headings from `response.reply` in the frontend? (assumption: parse from reply)
