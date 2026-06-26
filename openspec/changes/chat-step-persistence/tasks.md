# Tasks: chat-step-persistence

## Task 1: Message.jsx — Render pipelineSteps
**File**: `frontend/IdeaDashboardai-chatbot-interface-template/components/Message.jsx`
**Priority**: High
**Dependencies**: None

**Changes**:
- Rename `WizardResultMessage` to `StepRenderer`
- Make `StepRenderer` accept steps from both `pipelineSteps` (array of `{message, status}`) and `wizardData.steps` (array of `{message, status, ts}`)
- `ts` field is optional — if missing, render without timestamp
- In main `Message` component, detect `message.pipelineSteps` in addition to `message.wizardData`
- Render `StepRenderer` when either exists, before the markdown content
- Keep existing markdown rendering as fallback

**Acceptance**: Assistant messages with `pipelineSteps` show steps. Messages without metadata show only content. Wizard messages still render correctly.

## Task 2: useChat.js — Rehydrate pipelineSteps on conversation load
**File**: `frontend/IdeaDashboardai-chatbot-interface-template/hooks/useChat.js`
**Priority**: High
**Dependencies**: Task 1

**Changes**:
- Add `useEffect` that watches `selectedConversation?.id`
- On change, scan messages for the last assistant message
- If it has `pipelineSteps`, call `setLatestPipelineSteps(lastAssistant.pipelineSteps)`
- If it has `wizardData.steps`, call `setLatestPipelineSteps(lastAssistant.wizardData.steps)`
- Otherwise, clear `latestPipelineSteps`
- This effect runs on mount (page load), conversation switch, and data refresh

**Acceptance**: Opening any conversation restores its pipeline steps. Switching conversations clears/resets the panel state correctly.

## Task 3: ChatPane.jsx — Remove CompletedPipeline, simplify step logic
**File**: `frontend/IdeaDashboardai-chatbot-interface-template/components/ChatPane.jsx`
**Priority**: High
**Dependencies**: Task 1, Task 2

**Changes**:
- Remove the `CompletedPipeline` component (lines 81-97)
- Remove the conditional rendering of `CompletedPipeline` (lines 260-262)
- Simplify `panelSteps` logic: during streaming, use `progressSteps`; after completion, use `latestPipelineSteps`
- Remove the `isDirectExtraction` bifurcation if possible, or simplify it
- Keep `ProgressMessage` for live streaming (it's needed)

**Acceptance**: Messages rendered by Message.jsx show steps directly. Panel keeps showing step count + elapsed time. No visual regression.

## Task 4: Verify all three changes work together
**Priority**: High
**Dependencies**: Task 3

**Test cases**:
1. Send "reporte CUIT 20324837796" → steps during stream → steps after complete → steps after refresh
2. Use wizard → wizard steps visible → steps persist after conversation switch
3. Switch between conversations → no stale steps
4. Old conversations without metadata → normal markdown rendering
