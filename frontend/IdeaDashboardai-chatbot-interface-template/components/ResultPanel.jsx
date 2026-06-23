"use client"

import { Database, FileText, Clock, CheckCircle, Loader2, CalendarDays, Globe, File, Mail, Building2 } from "lucide-react"

/**
 * Section icon/color mapping — matches the visual style of the generated PDF.
 */
const SECTION_META = {
  padron:    { icon: Building2,  color: "text-blue-600 dark:text-blue-400",  bg: "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800", label: "Padrón A5" },
  calendario:{ icon: CalendarDays, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800", label: "Calendario fiscal" },
  browser:   { icon: Globe,       color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800", label: "Extracción browser" },
  pdf:       { icon: File,        color: "text-orange-600 dark:text-orange-400", bg: "bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800", label: "PDF" },
  email:     { icon: Mail,        color: "text-sky-600 dark:text-sky-400",     bg: "bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800", label: "Email" },
}

/**
 * Parse progress steps into structured sections for the report.
 */
function parseSections(steps) {
  const sections = []
  let current = null

  for (const s of steps) {
    const msg = s.message.trim()
    if (msg.includes("Consultando Padrón") || msg.includes("✅ Datos del Padrón")) {
      current = { key: "padron", items: [] }
      sections.push(current)
    } else if (msg.includes("Calculando calendario") || msg.includes("✅ Calendario fiscal")) {
      current = { key: "calendario", items: [] }
      sections.push(current)
    } else if (msg.includes("Composio") || msg.includes("Extrayendo vía")) {
      current = { key: "browser", items: [] }
      sections.push(current)
    } else if (msg.includes("Generando PDF") || msg.includes("✅ PDF")) {
      current = { key: "pdf", items: [] }
      sections.push(current)
    } else if (msg.includes("Email")) {
      current = { key: "email", items: [] }
      sections.push(current)
    } else if (current && s.status !== "in_progress" && !msg.startsWith("Consultando") && !msg.startsWith("Calculando") && !msg.startsWith("Generando") && !msg.startsWith("Extrayendo")) {
      current.items.push(msg)
    }
  }
  return sections
}

export default function ResultPanel({ result, elapsedMs, stepsCount, steps, wizardActive = false }) {
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

  const sections = parseSections(steps || [])

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
            <span>{stepsCount} pasos · {sections.length} secciones</span>
          </div>
        )}
      </div>

      {/* Scrollable report body — styled like a printed document */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5 pt-4">

        {/* Company header — like the PDF letterhead */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900/50">
          <h1 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
            Reporte fiscal
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {result.reply.split("\n")[0].replace(/\*\*/g, "")}
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="h-3.5 w-3.5" />
            Reporte generado exitosamente
          </div>
        </div>

        {/* Data sections — each extracted step becomes a visual card */}
        {sections.length > 0 && (
          <div className="space-y-3">
            {sections.map((section) => {
              const meta = SECTION_META[section.key] || SECTION_META.padron
              const Icon = meta.icon

              return (
                <div key={section.key} className={`rounded-xl border p-4 ${meta.bg}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className={`h-4 w-4 ${meta.color}`} />
                    <span className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>
                      {meta.label}
                    </span>
                    <CheckCircle className="ml-auto h-3.5 w-3.5 text-green-500" />
                  </div>
                  {section.items.length > 0 ? (
                    <ul className="space-y-1">
                      {section.items.map((item, i) => (
                        <li key={i} className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-zinc-400 dark:text-zinc-500">Datos extraídos correctamente</p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Reply text as detail section */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900/50">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Detalle del reporte
          </h3>
          <div className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
            {result.reply
              .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
              .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="underline text-blue-600 dark:text-blue-400">$1</a>')
              .replace(/\n/g, '<br>')}
          </div>
        </div>
      </div>

    </div>
  )
}
