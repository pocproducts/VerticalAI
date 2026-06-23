"use client"

import { useState } from "react"
import { FileText } from "lucide-react"

/**
 * @typedef {Object} WizardTasks
 * @property {boolean} deuda
 * @property {boolean} facilidades
 * @property {boolean} registro
 * @property {boolean} iibb
 */

const DEFAULT_TASKS = {
  deuda: true,
  facilidades: true,
  registro: true,
  iibb: false,
}

const TASK_LABELS = {
  deuda: "Deuda real",
  facilidades: "Planes de pago",
  registro: "Registro tributario",
  iibb: "Jurisdicciones IIBB",
}

/**
 * Step 2 of the wizard: shows client info and task checkboxes.
 *
 * @param {{
 *   cliente: { nombre: string, cuit: string, tipo?: string } | null,
 *   onGenerate: (tasks: WizardTasks) => void,
 *   loading?: boolean,
 * }} props
 */
export default function WizardStepTasks({ cliente, onGenerate, loading }) {
  const [tasks, setTasks] = useState(DEFAULT_TASKS)

  function toggle(key) {
    setTasks((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    onGenerate(tasks)
  }

  const anySelected = Object.values(tasks).some(Boolean)

  return (
    <div className="space-y-5">
      {/* Client info */}
      {cliente && (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-800/50">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Cliente descubierto
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {cliente.nombre}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            CUIT: {cliente.cuit}
            {cliente.tipo ? ` · ${cliente.tipo}` : ""}
          </p>
        </div>
      )}

      {/* Task checkboxes */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          ¿Qué querés extraer?
        </p>

        <div className="space-y-2">
          {Object.entries(TASK_LABELS).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
            >
              <input
                type="checkbox"
                checked={tasks[key]}
                onChange={() => toggle(key)}
                className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500 dark:border-zinc-600 dark:bg-zinc-800"
              />
              <span className="text-sm text-zinc-800 dark:text-zinc-200">{label}</span>
            </label>
          ))}
        </div>

        <button
          type="submit"
          disabled={!anySelected || loading}
          className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {loading ? (
            <>
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generando...
            </>
          ) : (
            <>
              <FileText className="h-4 w-4" />
              Generar reporte
            </>
          )}
        </button>
      </form>
    </div>
  )
}
