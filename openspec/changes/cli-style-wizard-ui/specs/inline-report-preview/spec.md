# Delta for inline-report-preview

## ADDED Requirements

### Requirement: Generating State

When the wizard is actively processing (started but not completed), the system MUST display "Previsualización se está generando..." in the right column instead of the grey placeholder. This GENERATING state SHALL supersede the empty-state placeholder while processing is active.

#### Scenario: Wizard is processing

- GIVEN the wizard has started but not yet completed
- WHEN `wizardActive` is `true` and no result exists
- THEN the right column shows "Previsualización se está generando..." with a subtle loading indicator
- AND no grey placeholder, PDF viewer, or download button is shown

#### Scenario: Generating state transitions to result

- GIVEN the generating state is visible
- WHEN the wizard completes with a result
- THEN the generating state is replaced by the rendered report

## MODIFIED Requirements

### Requirement: Loading State

When the PDF is being fetched and rendered, the system MUST display a loading indicator.
(Previously: Loading state kept the "Descargar PDF" button visible during load)

#### Scenario: PDF is loading

- GIVEN the wizard completed with a valid `pdf_url`
- WHEN the PDF document is being fetched by react-pdf
- THEN a loading spinner or skeleton is displayed

### Requirement: Error State

If the PDF fails to load (network error, invalid PDF, CORS), the system MUST display an error message.
(Previously: Error state kept a "Descargar PDF" button visible for direct download)

#### Scenario: PDF fails to load

- GIVEN the wizard completed with a valid `pdf_url`
- WHEN the PDF fails to load (`onLoadError` fires)
- THEN the right column shows "No se pudo cargar el PDF"

### Requirement: Report Activation

When the wizard completes, the right column MUST receive the final result (`result.reply` and `result.pdf_url`) and render the PDF inline viewer, replacing the grey placeholder or generating state without page reload.
(Previously: Report activation mentioned the download button appearing alongside result)

#### Scenario: Wizard completes with PDF URL

- GIVEN the grey placeholder or generating state is visible
- WHEN the wizard completes and passes `result.reply` and `result.pdf_url`
- THEN the placeholder is replaced by the PDF inline viewer (loading state, then rendered PDF)

### Requirement: PDF Preview Rendering

When `pdf_url` is present, the system MUST render the PDF using react-pdf's `<Document>` and `<Page>` components. When `pdf_url` is absent, the system SHOULD fall back to rendering `result.reply` as styled HTML.
(Previously: Scenarios referenced the "Descargar PDF" button — removed)

#### Scenario: PDF URL present — PDF rendered

- GIVEN a completed wizard result with a non-empty `result.pdf_url`
- WHEN the preview renders
- THEN the PDF is rendered inline via react-pdf
- AND the viewer is scrollable for multi-page PDFs

#### Scenario: PDF URL absent — HTML fallback

- GIVEN a completed wizard result with no `result.pdf_url`
- WHEN the preview renders
- THEN `result.reply` is rendered as styled HTML
- AND bold text (`**text**`) appears as `<strong>`
- AND links render as clickable with `target="_blank"`
- AND newlines produce visible line breaks

#### Scenario: PDF URL present but fails to load

- GIVEN a completed wizard result with `result.pdf_url`
- WHEN the PDF fails to load
- THEN the error message "No se pudo cargar el PDF" is shown

## REMOVED Requirements

### Requirement: PDF Download

(Reason: HTML preview IS the report; the "Descargar PDF" download button is removed because the download flow now goes through the email input. The backend `pdf_url` remains available but the UI no longer exposes a direct `<a>` download button.)
