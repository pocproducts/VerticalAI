# Tasks: PDF Real Viewer

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 250–350 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Dependencies

- [x] 1.1 Add `react-pdf` to `package.json` in `frontend/IdeaDashboardai-chatbot-interface-template/` — run `npm install react-pdf`

## Phase 2: PDF Viewer (ResultPanel.jsx)

- [x] 2.1 Configure PDF.js worker via CDN URL (`pdfjs.GlobalWorkerOptions.workerSrc`) + dynamic import with `ssr: false` in `ResultPanel.jsx`
- [x] 2.2 Add loading state: spinner/skeleton shown while `<Document>` fetches the PDF; keep download button visible
- [x] 2.3 Replace markdown render with `<Document file={pdf_url}>` + `<Page>` for each page; make container scrollable for multi-page PDFs
- [x] 2.4 Add error state: user-facing message ("No se pudo cargar el PDF") on `onLoadError`; keep download button visible
- [x] 2.5 Keep "Descargar PDF" `<a>` button — shown in loading/success/error states when `pdf_url` present; hidden when absent; HTML fallback for `result.reply` when `pdf_url` absent

## Phase 3: Rich Conversation Results

- [x] 3.1 `WizardOnboarding.jsx`: change `onWizardComplete` 5th param from `stepsCount` (number) to `progressSteps` (array); update JSDoc signature
- [x] 3.2 `ChatPane.jsx`: update `handleWizardComplete` to receive `progressSteps` array; derive `stepsCount = progressSteps.length` for ResultPanel; forward `wizardData = { steps, elapsedMs, sections, pdf_url }` as 3rd arg to parent `onWizardComplete`
- [x] 3.3 `useChat.js`: update `onWizardComplete` to `(convId, reply, wizardData)`; store `wizardData` on assistant message as optional field (`{ content: reply, wizardData }`) — backward compat for existing messages without it
- [x] 3.4 `Message.jsx`: if `message.wizardData` exists, render rich result card (steps list with statuses, elapsed time, parsed sections, PDF download link); else render `children` as-is

## Phase 4: Integration

- [x] 4.1 Rebuild frontend container: `docker compose up -d --build frontend` — `npm install` picks up `react-pdf`
