"use client"

import { FileText, CheckCircle, ExternalLink, Clock, ListChecks } from "lucide-react"

/**
 * Final step: shows the wizard result with PDF download link.
 *
 * @param {{
 *   reply: string,
 *   pdfUrl?: string | null,
 *   conversationId?: string,
 *   onStartNew?: () => void,
 *   elapsedMs?: number,
 *   stepsCount?: number,
 * }} props
 */
export default function WizardResult({ reply, pdfUrl, onStartNew, elapsedMs, stepsCount }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <CheckCircle className="h-5 w-5" />
        <span className="text-sm font-medium">Reporte generado exitosamente</span>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-xs text-zinc-500">
        {stepsCount != null && (
          <span className="flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5" />
            {stepsCount} pasos
          </span>
        )}
        {elapsedMs != null && (
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm leading-relaxed text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-300">
        {reply}
      </div>

      {pdfUrl && (
        <a
          href={pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          <FileText className="h-4 w-4" />
          Descargar PDF
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      {onStartNew && (
        <button
          onClick={onStartNew}
          className="block text-sm text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          Generar otro reporte
        </button>
      )}
    </div>
  )
}
