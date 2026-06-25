"use client"

import { FileText, Clock, CheckCircle, Loader2, Database, ExternalLink } from "lucide-react"

/**
 * Simple markdown → HTML for the report preview.
 * Supports: **bold**, [links](url), \n newlines.
 */
function renderMarkdown(text) {
  if (!text) return ""
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline text-blue-600 dark:text-blue-400 hover:text-blue-800">$1</a>',
  )
  html = html.replace(/\n/g, "<br>")
  return html
}

/**
 * Extract PDF download URL from the reply markdown (if any).
 */
function extractPdfUrl(reply) {
  if (!reply) return null
  const m = reply.match(/\[([^\]]+)\]\(\s*(\/v1\/chat\/reports\/[^)\s]+)\s*\)/)
  return m ? m[2] : null
}

export default function ResultPanel({ result, elapsedMs, stepsCount, wizardActive = false }) {
  if (!result && !wizardActive) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <Database className="mx-auto h-10 w-10 text-zinc-300 dark:text-zinc-700" />
          <p className="mt-3 text-sm text-zinc-400 dark:text-zinc-600">
            Completá el wizard para ver el reporte.
          </p>
        </div>
      </div>
    )
  }

  if (!result && wizardActive) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-blue-500" />
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
            Previsualización se está generando...
          </p>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
            Esto puede tomar unos minutos.
          </p>
        </div>
      </div>
    )
  }

  const pdfUrl = extractPdfUrl(result.reply)
  const titleLine = (result.reply || "").split("\n")[0].replace(/\*\*/g, "")

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-zinc-500" />
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Reporte fiscal
          </h2>
        </div>
        {elapsedMs > 0 && (
          <div className="mt-1 flex items-center gap-3 text-xs text-zinc-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`}
            </span>
            <span>{stepsCount} pasos</span>
          </div>
        )}
      </div>

      {/* Report preview — clean markdown rendering */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5 pt-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
          <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            {titleLine || "Reporte fiscal"}
          </h1>
          <div className="mt-3 flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="h-3.5 w-3.5" />
            Reporte generado exitosamente
          </div>
        </div>

        {/* Markdown preview of the full report */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Detalle del reporte
          </h3>
          <div
            className="prose prose-sm max-w-none text-zinc-700 dark:text-zinc-300 [&_br]:content-[''] [&_br]:block [&_br]:mb-1"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(result.reply),
            }}
          />
        </div>

        {/* PDF download */}
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
      </div>
    </div>
  )
}
