import { cls, renderMarkdown } from "./utils"
import { CheckCircle } from "lucide-react"

function WizardResultMessage({ message }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle className="h-5 w-5" />
        <span className="text-sm font-medium">Reporte generado exitosamente</span>
      </div>
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
