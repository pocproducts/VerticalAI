import { cls } from "./utils"
import { Eye, Loader2 } from "lucide-react"

function StepRenderer({ steps }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800/50">
      <div className="space-y-1 font-mono text-xs leading-6">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2">
            <span className="shrink-0 mt-0.5">
              {step.status === "in_progress" ? (
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
              ) : step.status === "done" || step.message.includes("✅") ? (
                <span className="text-green-500">✓</span>
              ) : step.status === "error" || step.message.includes("❌") ? (
                <span className="text-red-500">✗</span>
              ) : step.status === "warning" || step.message.includes("⚠️") ? (
                <span className="text-amber-500">⚠</span>
              ) : (
                <span className="text-zinc-400">·</span>
              )}
            </span>
            <span className={cls(
              "break-all",
              step.status === "error" || step.message.includes("❌")
                ? "text-red-600 dark:text-red-400"
                : step.status === "in_progress"
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-zinc-600 dark:text-zinc-400",
            )}>
              {step.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Message({ role, children, message, onShowPipeline }) {
  const isUser = role === "user"
  const pipelineSteps = message?.pipelineSteps || []
  const wizardSteps = message?.wizardData?.steps || []
  const effectiveSteps = pipelineSteps.length > 0 ? pipelineSteps : wizardSteps

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
        {effectiveSteps.length > 0 ? (
          <>
            <StepRenderer steps={effectiveSteps} />
            <button
              onClick={() => onShowPipeline?.(message)}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <Eye className="h-3.5 w-3.5" />
              Ver previsualización
            </button>
          </>
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
