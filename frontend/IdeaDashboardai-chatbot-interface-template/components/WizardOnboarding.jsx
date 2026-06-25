"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useAuth } from "@clerk/nextjs"
import { Square } from "lucide-react"
import WizardStepCuit from "./WizardStepCuit"
import WizardStepTasks from "./WizardStepTasks"
import WizardResult from "./WizardResult"
import apiClient from "../lib/api-client"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

/**
 * Inline progress display — mirrors ProgressMessage from ChatPane.
 */
function ProgressSteps({ steps, onCancel, elapsedMs }) {
  const lastInProgress = [...steps].reverse().findIndex((s) => s.status === "in_progress")
  const currentIdx = lastInProgress >= 0 ? steps.length - 1 - lastInProgress : -1

  return (
    <div className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="space-y-0.5 font-mono text-sm leading-6">
        {steps.map((step, i) => {
          const msg = step.message.trim()
          const isCurrent = i === currentIdx

          return (
            <div key={i} className="flex items-start gap-2">
              {isCurrent && (
                <svg className="h-4 w-4 shrink-0 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {!isCurrent && <span className="w-4 shrink-0" />}
              {renderMessage(msg, step)}
            </div>
          )
        })}
      </div>
      {elapsedMs != null && steps.length > 1 && (
        <div className="mt-2 text-xs text-zinc-400">
          {steps.length} pasos · {elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`}
        </div>
      )}
      {onCancel && (
        <button
          onClick={onCancel}
          className="mt-3 inline-flex items-center gap-1 rounded-full border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          <Square className="h-3 w-3" /> Cancelar
        </button>
      )}
    </div>
  )
}

/**
 * Classify a progress message for UI styling.
 */
function stepStatus(msg) {
  if (msg.endsWith("...")) return "in_progress"
  if (msg.includes("✅") || msg.includes("✓")) return "done"
  if (msg.includes("❌")) return "error"
  if (msg.includes("⚠️")) return "warning"
  return "info"
}

/**
 * Render a step message with CLI-style formatting based on prefix patterns.
 */
function renderMessage(msg, step) {
  const trimmed = msg.trim()

  if (trimmed.startsWith("───")) {
    return <div className="text-center text-zinc-400/50 text-xs py-0.5">{trimmed}</div>
  }

  if (trimmed.startsWith("🔗 Live:")) {
    const url = trimmed.replace("🔗 Live:", "").trim()
    return <a href={url} target="_blank" rel="noopener noreferrer" className="underline text-blue-500 hover:text-blue-700">{url}</a>
  }

  if (trimmed.startsWith("✓")) {
    return <span className="text-green-600 dark:text-green-400">{msg}</span>
  }

  const colorClass =
    step.status === "error"
      ? "text-red-600 dark:text-red-400"
      : step.status === "done"
        ? "text-zinc-600 dark:text-zinc-400"
        : "text-zinc-800 dark:text-zinc-200"

  return <span className={colorClass}>{msg}</span>
}

/**
 * Process a progress message into the steps array.
 */
function processProgress(prev, msg) {
  const status = stepStatus(msg)
  if (status === "in_progress") {
    const updated = prev.map((s) =>
      s.status === "in_progress" ? { ...s, status: "done" } : s,
    )
    return [...updated, { message: msg, status: "in_progress", ts: Date.now() }]
  }
  if (status === "done" || status === "error") {
    const updated = prev.map((s) =>
      s.status === "in_progress" ? { ...s, status: "done", ts: Date.now() } : s,
    )
    return [...updated, { message: msg, status, ts: Date.now() }]
  }
  return [...prev, { message: msg, status, ts: Date.now() }]
}

/**
 * WizardOnboarding — guides the user through CUIT → tasks → processing → complete.
 *
 * Manages its own local state and calls the backend directly. When the
 * wizard completes, it calls ``onWizardComplete(convId, reply, response, elapsedMs, stepsCount, progressSteps)``
 * so the parent can insert the assistant message into the conversation
 * and capture result data for the right column.
 *
 * @param {{
 *   onWizardComplete: (convId: string, reply: string, response?: object, elapsedMs?: number, stepsCount?: number, progressSteps?: Array) => void,
 * }} props
 */
export default function WizardOnboarding({ onWizardComplete, onProcessingChange }) {
  const { getToken, isSignedIn } = useAuth()

  // State machine
  const [step, setStep] = useState("cuit") // cuit | tasks | processing | complete | error
  const [cuit, setCuit] = useState("")
  const [conversationId, setConversationId] = useState(null)
  const [clienteInfo, setClienteInfo] = useState(null)
  const [tasks, setTasks] = useState(null)
  const [progressSteps, setProgressSteps] = useState([])
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [discovering, setDiscovering] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [emailTo, setEmailTo] = useState("")
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(null)

  const abortRef = useRef(null)
  const startTimeRef = useRef(null)
  const timerRef = useRef(null)
  const stepsRef = useRef([])

  // Live timer during processing
  useEffect(() => {
    if (step === "processing" && startTimeRef.current) {
      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current)
      }, 100)
      return () => clearInterval(timerRef.current)
    }
  }, [step])

  /**
   * Step 1 → 2: User entered CUIT → discover client.
   */
  const handleCuitSubmit = useCallback(async (cuitValue) => {
    setCuit(cuitValue)
    setDiscovering(true)
    setError(null)

    try {
      const token = isSignedIn ? await getToken() : null
      const headers = { "Content-Type": "application/json" }
      if (token) {
        headers["Authorization"] = `Bearer ${token}`
      }

      const res = await fetch(`${API_URL}/v1/chat/wizard`, {
        method: "POST",
        headers,
        body: JSON.stringify({ cuit: cuitValue }),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "")
        throw new Error(text || `Error ${res.status}`)
      }

      const data = await res.json()

      if (data.state === "error") {
        setError(data.reply)
        return
      }

      if (data.state === "awaiting_tasks") {
        setConversationId(data.conversation_id)
        setClienteInfo(data.cliente || null)
        setStep("tasks")
      } else {
        setError(data.reply || "Respuesta inesperada del servidor")
      }
    } catch (err) {
      setError(err.message || "Error de conexión")
    } finally {
      setDiscovering(false)
    }
  }, [isSignedIn, getToken])

  /**
   * Step 2 → 3: User selected tasks → run pipeline via SSE.
   */
  const handleGenerate = useCallback(async (selectedTasks) => {
    setTasks(selectedTasks)
    setStep("processing")
    setProgressSteps([])
    setError(null)
    startTimeRef.current = Date.now()
    onProcessingChange?.(true)

    const { promise, abort } = apiClient.sendWizard(
      isSignedIn ? await getToken() : null,
      {
        cuit,
        tasks: {
          deuda: !!selectedTasks.deuda,
          facilidades: !!selectedTasks.facilidades,
          registro: !!selectedTasks.registro,
          iibb: !!selectedTasks.iibb,
        },
        conversation_id: conversationId,
      },
      {
        onProgress: (data) => {
          setProgressSteps((prev) => {
            const next = processProgress(prev, data.message)
            stepsRef.current = next
            return next
          })
        },
      },
    )

    abortRef.current = abort

    try {
      const response = await promise
      setElapsedMs(Date.now() - startTimeRef.current)
      setResult(response)
      setStep("complete")
      setEmailTo((prev) => prev || clienteInfo?.email || "")
      onProcessingChange?.(false)

      if (onWizardComplete && response.reply) {
        const finalSteps = stepsRef.current
        onWizardComplete(
          response.conversation_id || conversationId,
          response.reply,
          response,
          Date.now() - startTimeRef.current,
          finalSteps.length,
          finalSteps,
        )
      }
    } catch (err) {
      if (err.message === "ABORTED") {
        setError("⏸️ Generación cancelada.")
        setStep("error")
      } else {
        setError(err.message || "Error al generar el reporte")
        setStep("error")
      }
      onProcessingChange?.(false)
    }
  }, [cuit, conversationId, clienteInfo, isSignedIn, getToken, onWizardComplete, onProcessingChange])

  /**
   * Cancel the SSE stream during processing.
   */
  const handleCancel = useCallback(() => {
    abortRef.current?.()
    onProcessingChange?.(false)
  }, [onProcessingChange])

  /**
   * Reset the wizard to start a new report.
   */
  const handleStartNew = useCallback(() => {
    setStep("cuit")
    setCuit("")
    setConversationId(null)
    setClienteInfo(null)
    setTasks(null)
    setProgressSteps([])
    setResult(null)
    setError(null)
    setElapsedMs(0)
    setEmailTo("")
    setEmailSent(null)
    startTimeRef.current = null
    onProcessingChange?.(false)
  }, [onProcessingChange])

  const handleSendEmail = useCallback(async () => {
    if (!emailTo) return
    setSendingEmail(true)
    setEmailSent(null)
    try {
      const token = isSignedIn ? await getToken() : null
      const headers = { "Content-Type": "application/json" }
      if (token) headers["Authorization"] = `Bearer ${token}`

      const res = await fetch(`${API_URL}/v1/chat/wizard/send-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          conversation_id: conversationId,
          email: emailTo,
        }),
      })

      if (!res.ok) throw new Error("Send failed")
      setEmailSent(true)
    } catch {
      setEmailSent(false)
    } finally {
      setSendingEmail(false)
    }
  }, [emailTo, conversationId, isSignedIn, getToken])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Generar informe fiscal
        </h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Completá los pasos para generar un reporte completo del contribuyente.
        </p>
      </div>

      {/* Step indicator */}
      <div className="mb-5 flex items-center gap-2">
        {["cuit", "tasks", "processing", "complete"].map((s, i) => {
          const isActive = step === s
          const isDone =
            (s === "cuit" && (step === "tasks" || step === "processing" || step === "complete")) ||
            (s === "tasks" && (step === "processing" || step === "complete")) ||
            (s === "processing" && step === "complete")

          return (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                  isActive
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : isDone
                      ? "bg-green-500 text-white"
                      : "bg-zinc-200 text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400"
                }`}
              >
                {isDone ? "✓" : i + 1}
              </div>
              {i < 3 && (
                <div
                  className={`h-px w-6 ${
                    isDone ? "bg-green-500" : "bg-zinc-200 dark:bg-zinc-700"
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Step content */}
      {step === "cuit" && (
        <>
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
          <WizardStepCuit onNext={handleCuitSubmit} disabled={discovering} />
        </>
      )}

      {step === "tasks" && (
        <WizardStepTasks
          cliente={clienteInfo}
          onGenerate={handleGenerate}
        />
      )}

      {step === "processing" && (
        <div className="space-y-2">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Generando reporte fiscal...
          </p>
          <ProgressSteps steps={progressSteps} onCancel={handleCancel} elapsedMs={elapsedMs} />
        </div>
      )}

      {step === "complete" && result && (
        <>
          <WizardResult
            reply={result.reply}
            pdfUrl={result.pdf_url}
            conversationId={result.conversation_id}
            onStartNew={handleStartNew}
            elapsedMs={elapsedMs}
            stepsCount={progressSteps.length}
          />
          {/* Email input */}
          <div className="border-t border-zinc-200 pt-4 mt-4 dark:border-zinc-700">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Enviar reporte por email
            </label>
            <div className="flex gap-2">
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="email@ejemplo.com"
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
              />
              <button onClick={handleSendEmail} disabled={sendingEmail}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
                {sendingEmail ? "Enviando..." : "Enviar"}
              </button>
            </div>
            {emailSent === true && <p className="mt-1 text-xs text-green-600">✅ Enviado</p>}
            {emailSent === false && <p className="mt-1 text-xs text-red-600">❌ Error al enviar</p>}
          </div>
        </>
      )}

      {step === "error" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
            {error || "Ocurrió un error inesperado."}
          </div>
          <button
            onClick={handleStartNew}
            className="text-sm text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
          >
            Intentar de nuevo
          </button>
        </div>
      )}
    </div>
  )
}
