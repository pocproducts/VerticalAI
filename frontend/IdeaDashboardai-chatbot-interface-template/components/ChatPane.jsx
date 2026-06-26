"use client"

import { useState, forwardRef, useImperativeHandle, useRef, useCallback } from "react"
import { Pencil, RefreshCw, Check, X, Square } from "lucide-react"
import Message from "./Message"
import WizardOnboarding from "./WizardOnboarding"
import ResultPanel from "./ResultPanel"
import { cls, timeAgo, renderMarkdown } from "./utils"

function ThinkingMessage({ onPause }) {
  return (
    <Message role="assistant">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]"></div>
          <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]"></div>
          <div className="h-2 w-2 animate-bounce rounded-full bg-zinc-400"></div>
        </div>
        <span className="text-sm text-zinc-500">Procesando...</span>
        <button
          onClick={onPause}
          className="ml-auto inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Square className="h-3 w-3" /> Pausar
        </button>
      </div>
    </Message>
  )
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-blue-500 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function ProgressMessage({ steps, onPause }) {
  const lastInProgress = [...steps].reverse().findIndex(s => s.status === "in_progress")
  const currentIdx = lastInProgress >= 0 ? steps.length - 1 - lastInProgress : -1

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="space-y-0.5 font-mono text-sm leading-6">
        {steps.map((step, i) => {
          const msg = step.message.trim()
          const hasInlineEmoji = /^[✅❌⚠️]/.test(msg)
          const isCurrent = i === currentIdx

          return (
            <div key={i} className="flex items-start gap-2">
              {!hasInlineEmoji && isCurrent && <Spinner />}
              {!hasInlineEmoji && !isCurrent && <span className="w-4 shrink-0" />}
              <span
                className={
                  step.status === "error"
                    ? "text-red-600 dark:text-red-400"
                    : isCurrent
                      ? "text-zinc-800 dark:text-zinc-200"
                      : "text-zinc-600 dark:text-zinc-400"
                }
              >
                {msg}
              </span>
            </div>
          )
        })}
      </div>
      <button
        onClick={onPause}
        className="mt-3 inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <Square className="h-3 w-3" /> Cancelar
      </button>
    </div>
  )
}

const ChatPane = forwardRef(function ChatPane(
  { conversation, onSend, onEditMessage, onResendMessage, isThinking, progressSteps, onPauseThinking, onWizardComplete, latestResult, latestPipelineSteps },
  ref,
) {
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState("")

  // ── Right panel state (from wizard completion) ───────────────────
  const [wizardResult, setWizardResult] = useState(null)
  const [wizardElapsed, setWizardElapsed] = useState(0)
  const [wizardStepsCount, setWizardStepsCount] = useState(0)
  const [wizardSteps, setWizardSteps] = useState([])
  const [wizardProcessing, setWizardProcessing] = useState(false)
  const handleProcessingChange = useCallback((active) => setWizardProcessing(active), [])

  // ── Pipeline preview (Ver previsualización) ──────────────────────
  // Set when user clicks "Ver previsualización" on a message.
  // Shows the full pipeline output in the right panel.
  const [pipelinePreview, setPipelinePreview] = useState(null)
  const handleShowPipeline = useCallback((msg) => {
    setPipelinePreview({
      steps: msg?.pipelineSteps || msg?.wizardData?.steps || [],
      content: msg?.content || '',
      elapsed: '',
    })
  }, [])

  // ── ResultPanel: merge wizard + message preview ──────────────────
  const isProcessing = isThinking && progressSteps?.length > 0
  // During streaming: show progress; after stream: wait for "Ver previsualización"
  const panelResult = pipelinePreview
    ? { reply: pipelinePreview.content }
    : isProcessing
      ? null
      : wizardResult
  const panelActive = isProcessing || wizardProcessing || pipelinePreview !== null
  // During streaming show live steps; when previewing show saved steps
  const panelSteps = pipelinePreview
    ? pipelinePreview.steps
    : isProcessing
      ? progressSteps || []
      : wizardSteps

  const handleWizardComplete = useCallback((convId, reply, fullResult, elapsedMs, stepsCount, progressSteps) => {
    if (fullResult) {
      setWizardResult({ reply: fullResult.reply, pdf_url: fullResult.pdf_url })
    }
    setWizardElapsed(elapsedMs || 0)
    setWizardStepsCount(stepsCount || 0)
    setWizardSteps(progressSteps || [])
    onWizardComplete?.(convId, reply, {
      elapsedMs: elapsedMs || 0,
      stepsCount: stepsCount || 0,
      steps: progressSteps || [],
    })
  }, [onWizardComplete])

  useImperativeHandle(
    ref,
    () => ({}),
    [],
  )

  const renderLeftColumn = () => {
    if (!conversation) {
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-8">
            <WizardOnboarding
              onWizardComplete={handleWizardComplete}
              onProcessingChange={handleProcessingChange}
            />
          </div>
        </div>
      )
    }

    const messages = Array.isArray(conversation.messages) ? conversation.messages : []
    const count = messages.length || conversation.messageCount || 0

    function startEdit(m) {
      setEditingId(m.id)
      setDraft(m.content)
    }
    function cancelEdit() {
      setEditingId(null)
      setDraft("")
    }
    function saveEdit() {
      if (!editingId) return
      onEditMessage?.(editingId, draft)
      cancelEdit()
    }
    function saveAndResend() {
      if (!editingId) return
      onEditMessage?.(editingId, draft)
      onResendMessage?.(editingId)
      cancelEdit()
    }

    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-8">
          <div className="mb-2 text-3xl font-serif tracking-tight sm:text-4xl md:text-5xl">
            <span className="block leading-[1.05] font-sans text-2xl">{conversation.title}</span>
          </div>
          <div className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            Actualizado {timeAgo(conversation.updatedAt)} · {count} mensajes
          </div>

          {messages.length === 0 ? (
            <WizardOnboarding
              onWizardComplete={handleWizardComplete}
              onProcessingChange={handleProcessingChange}
            />
          ) : (
            <>
              {messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  {editingId === m.id ? (
                    <div className={cls("rounded-2xl border p-2", "border-zinc-200 dark:border-zinc-800")}>
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="w-full resize-y rounded-xl bg-transparent p-2 text-sm outline-none"
                        rows={3}
                      />
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={saveEdit}
                          className="inline-flex items-center gap-1 rounded-full bg-zinc-900 px-3 py-1.5 text-xs text-white dark:bg-white dark:text-zinc-900"
                        >
                          <Check className="h-3.5 w-3.5" /> Guardar
                        </button>
                        <button
                          onClick={saveAndResend}
                          className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs"
                        >
                          <RefreshCw className="h-3.5 w-3.5" /> Guardar y reenviar
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs"
                        >
                          <X className="h-3.5 w-3.5" /> Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Message role={m.role} message={m} onShowPipeline={handleShowPipeline}>
                      <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                      {m.role === "user" && (
                        <div className="mt-1 flex gap-2 text-[11px] text-zinc-500">
                          <button className="inline-flex items-center gap-1 hover:underline" onClick={() => startEdit(m)}>
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </button>
                          <button
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={() => onResendMessage?.(m.id)}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Reenviar
                          </button>
                        </div>
                      )}
                    </Message>
                  )}
                </div>
              ))}
              {isThinking && progressSteps && progressSteps.length > 0 ? (
                <ProgressMessage steps={progressSteps} onPause={onPauseThinking} />
              ) : isThinking ? (
                <ThinkingMessage onPause={onPauseThinking} />
              ) : null}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex flex-1 min-h-0">
        {/* Left column: wizard + history */}
        <div className="flex flex-1 min-w-0 border-r border-zinc-200 dark:border-zinc-800">
          {renderLeftColumn()}
        </div>

        {/* Right column: report preview */}
        <div className="hidden w-[380px] shrink-0 lg:flex flex-col bg-zinc-50/50 dark:bg-zinc-900/30">
          <ResultPanel
            result={panelResult}
            elapsedMs={pipelinePreview ? '' : wizardElapsed}
            stepsCount={panelSteps.length}
            steps={panelSteps}
            wizardActive={panelActive}
          />
        </div>
      </div>
    </div>
  )
})

export default ChatPane
