# Delta for chat-frontend

## ADDED Requirements

### Requirement: Wizard Result in Conversation

When the wizard completes via `onWizardComplete`, the system MUST store and display the full structured wizard result (steps, sections, elapsed time, extracted data) as the assistant message content, instead of only the plain `reply` text. This is a presentation change to how assistant messages render — no data model changes are required.

The assistant message MUST render:
- A summary of processing steps performed (count and status)
- Key extracted data sections
- Elapsed time of the extraction
- A link to download the PDF (if `pdf_url` is available)

#### Scenario: Wizard completion with full result

- GIVEN an active conversation with no messages yet
- WHEN the wizard completes and `onWizardComplete` fires with a structured result containing steps, sections, `elapsedMs`, and metadata
- THEN the assistant message stores the full structured data as its content
- AND the rendered message displays a steps summary (e.g., "3 pasos completados")
- AND the rendered message includes the extracted data sections
- AND the elapsed time is displayed (e.g., "Procesado en 12.4s")
- AND the PDF download link (if available) is shown inline
- AND the user can scroll through the full result within the message bubble

#### Scenario: Existing conversation messages unaffected

- GIVEN an existing conversation with messages stored before this change
- WHEN the conversation loads
- THEN previously stored assistant messages render as plain `reply` text (unchanged)
- AND only new wizard completions show the rich structured format

#### Scenario: Minimal result (no PDF)

- GIVEN a wizard that completes without producing a `pdf_url`
- WHEN the assistant message renders
- THEN the steps summary and extracted data sections are displayed
- AND no PDF download link is shown
- AND no error is displayed for the missing PDF
