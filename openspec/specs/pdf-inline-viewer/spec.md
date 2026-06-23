# pdf-inline-viewer Specification

## Purpose

The PDF inline viewer renders the wizard-generated PDF document inline in the right column using react-pdf. It handles empty, loading, error, and success states — each with distinct visual feedback — and provides a direct download button.

## Requirements

### Requirement: Empty State

When no result is available (no `pdf_url`), the system MUST display a grey placeholder panel with instructional text. It MUST NOT show any PDF-related UI (viewer, spinner, download button).

#### Scenario: No result yet

- GIVEN no wizard result is available
- WHEN the right column renders
- THEN it shows a grey placeholder panel with the text "Completá el wizard para ver el reporte"
- AND no PDF viewer, spinner, or download button is visible

### Requirement: Loading State

While the PDF is being fetched and rendered by react-pdf, the system MUST display a loading spinner or skeleton. The download button SHOULD remain visible during loading.

#### Scenario: PDF is loading

- GIVEN a valid `pdf_url` has been received
- WHEN the PDF document is being fetched and rendered
- THEN a loading spinner is displayed in the right column
- AND no placeholder, PDF content, or error message is visible
- AND the "Descargar PDF" button is visible

### Requirement: PDF Render

The system MUST render the PDF from the provided `pdf_url` using react-pdf's `<Document>` and `<Page>` components. The first page SHALL be visible on initial render. For multi-page PDFs, subsequent pages SHALL render below the first and the container MUST be scrollable.

#### Scenario: Single-page PDF

- GIVEN a completed wizard result with a valid `pdf_url` pointing to a single-page PDF
- WHEN the PDF finishes loading
- THEN the page is rendered at full width within the right column
- AND the content is visually clear and readable

#### Scenario: Multi-page PDF

- GIVEN a completed wizard result with a valid `pdf_url` pointing to a multi-page PDF
- WHEN the PDF finishes loading
- THEN all pages are rendered vertically in order
- AND the viewer scrolls to expose pages beyond the initial viewport

### Requirement: Error State

If the PDF fails to load (network error, invalid PDF, CORS issue), the system MUST display a user-facing error message. The download button MUST remain visible so the user can still open the PDF directly.

#### Scenario: PDF fails to load

- GIVEN a wizard result with a `pdf_url` that fails to load
- WHEN the `<Document>` component fires `onLoadError`
- THEN the right column shows "No se pudo cargar el PDF"
- AND the "Descargar PDF" button is visible
- AND clicking the button opens `pdf_url` in a new tab

### Requirement: Download Button

If `pdf_url` is provided, the system MUST display a visible button labeled "Descargar PDF". The button MUST open `pdf_url` in a new tab. If `pdf_url` is absent, the button MUST NOT be shown.

#### Scenario: Download PDF

- GIVEN a wizard result with a non-empty `pdf_url`
- WHEN the PDF viewer renders (loading, success, or error state)
- THEN the "Descargar PDF" button is visible
- AND clicking it opens `pdf_url` in a new tab with `target="_blank"` and `rel="noopener noreferrer"`

### Requirement: Scrollable

The right column MUST scroll vertically when the PDF content exceeds the viewport height. Scrolling MUST be independent of the left column.

#### Scenario: PDF taller than viewport

- GIVEN a rendered PDF whose total height exceeds the viewport
- WHEN the user scrolls in the right column
- THEN the right column scrolls independently
- AND the left column (wizard area) remains in its own scroll position
