import { cls, renderMarkdown } from "./utils"
import { CheckCircle, Loader2, ListChecks } from "lucide-react"

function WizardResultMessage({ message }) {
  const wizardData = message.wizardData
  const steps = wizardData?.steps || []

  return (
    <div className="space-y-3">
      {/* Success banner */}
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle className="h-5 w-5" />
        <span className="text-sm font-medium">Reporte generado exitosamente</span>
      </div>

      {/* Pipeline steps — exactamente como se ve en CLI */}
      {steps.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
          <div className="flex items-center gap-1 mb-2 text-xs text-zinc-500">
            <ListChecks className="h-3.5 w-3.5" />
            <span>{steps.length} pasos</span>
          </div>
          <div className="space-y-1 font-mono text-xs leading-5">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5">
                  {step.status === "in_progress" ? (
                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                  ) : step.status === "done" || step.message.includes("✅") ? (
                    <span className="text-green-500">✓</span>
                  ) : step.status === "error" || step.message.includes("❌") ? (
                    <span className="text-red-500">✗</span>
                  ) : (
                    <span className="text-zinc-300">·</span>
                  )}
                </span>
                <span
                  className={
                    step.status === "error" || step.message.includes("❌")
                      ? "text-red-600 dark:text-red-400"
                      : "text-zinc-600 dark:text-zinc-400"
                  }
                >
                  {step.message}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reply markdown */}
      <div className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300" dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
    </div>
  )
}

export default function Message({ role, children, message }) {
  const isUser = role === "user"
  const hasWizardData = message?.wizardData

  return (
    <div className={cls("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-900">
          AI
        </div>
      )}
      <div
        className={cls(
          "max-w-full rounded-2xl px-3 py-2 text-sm shadow-sm",
          isUser
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-800",
        )}
      >
        {hasWizardData ? (
          <WizardResultMessage message={message} />
        ) : (
          <>{children}</>
        )}
      </div>
      {isUser && (
        <div className="mt-0.5 grid h-7 w-7 place-items-center rounded-full bg-zinc-900 text-[10px] font-bold text-white dark:bg-white dark:text-zinc-900">
          JD
        </div>
      )}
    </div>
  )
}
