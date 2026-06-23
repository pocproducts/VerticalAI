# Delta for inline-report-preview

## ADDED Requirements

### Requirement: Loading State

When the PDF is being fetched and rendered, the system MUST display a loading indicator. The "Descargar PDF" button SHOULD remain visible during loading.

#### Scenario: PDF is loading

- GIVEN the wizard completed with a valid `pdf_url`
- WHEN the PDF document is being fetched by react-pdf
- THEN a loading spinner or skeleton is displayed
- AND the "Descargar PDF" button remains visible

### Requirement: Error State

If the PDF fails to load (network error, invalid PDF, CORS), the system MUST display an error message. The "Descargar PDF" button MUST remain visible for direct download.

#### Scenario: PDF fails to load

- GIVEN the wizard completed with a valid `pdf_url`
- WHEN the PDF fails to load (`onLoadError` fires)
- THEN the right column shows "No se pudo cargar el PDF"
- AND the "Descargar PDF" button remains visible and functional

## MODIFIED Requirements

### Requirement: Report Activation

When the wizard completes, the right column MUST receive the final result (`result.reply` and `result.pdf_url`) and render the PDF inline viewer, replacing the grey placeholder without page reload.
(Previously: "renders the report preview as styled HTML")

#### Scenario: Wizard completes with PDF URL

- GIVEN the grey placeholder is visible
- WHEN the wizard completes and passes `result.reply` and `result.pdf_url`
- THEN the placeholder is replaced by the PDF inline viewer (loading state, then rendered PDF)
- AND a "Descargar PDF" button is visible

### Requirement: PDF Preview Rendering

(Previously: "HTML Preview Rendering")

When `pdf_url` is present, the system MUST render the PDF using react-pdf's `<Document>` and `<Page>` components. When `pdf_url` is absent, the system SHOULD fall back to rendering `result.reply` as styled HTML.

#### Scenario: PDF URL present — PDF rendered

- GIVEN a completed wizard result with a non-empty `result.pdf_url`
- WHEN the preview renders
- THEN the PDF is rendered inline via react-pdf
- AND the viewer is scrollable for multi-page PDFs
- AND the "Descargar PDF" button is visible

#### Scenario: PDF URL absent — HTML fallback

- GIVEN a completed wizard result with no `result.pdf_url`
- WHEN the preview renders
- THEN `result.reply` is rendered as styled HTML
- AND bold text (`**text**`) appears as `<strong>`
- AND links render as clickable with `target="_blank"`
- AND newlines produce visible line breaks
- AND the PDF download button MUST NOT be shown

#### Scenario: PDF URL present but fails to load

- GIVEN a completed wizard result with `result.pdf_url`
- WHEN the PDF fails to load
- THEN the error message "No se pudo cargar el PDF" is shown
- AND the "Descargar PDF" button remains visible

### Requirement: PDF Download

(Unchanged — copied verbatim from existing spec)

If `result.pdf_url` is provided, the system MUST display a visible download button labeled "Descargar PDF". The button MUST open `result.pdf_url` in a new tab. If `result.pdf_url` is absent, the button MUST NOT be shown and no error SHALL be displayed.

#### Scenario: PDF URL present

- GIVEN a completed wizard result with a non-empty `result.pdf_url`
- WHEN the report preview renders
- THEN a "Descargar PDF" button is visible
- AND clicking it opens `result.pdf_url` in a new tab

#### Scenario: PDF URL absent

- GIVEN a completed wizard result with no `result.pdf_url`
- WHEN the report preview renders
- THEN the HTML preview SHALL render normally with the reply text
- AND the PDF download button MUST NOT be shown
