"use client"

import { useState } from "react"
import { ArrowRight, Loader2 } from "lucide-react"

/**
 * Step 1 of the wizard: CUIT input with 11-digit validation.
 *
 * @param {{ onNext: (cuit: string) => void, disabled?: boolean }} props
 */
export default function WizardStepCuit({ onNext, disabled = false }) {
  const [cuit, setCuit] = useState("")
  const [touched, setTouched] = useState(false)

  const digitsOnly = cuit.replace(/\D/g, "")
  const isValid = digitsOnly.length === 11
  const showError = touched && digitsOnly.length > 0 && !isValid
  const cantSubmit = !isValid || disabled

  function handleChange(e) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 11)
    setCuit(raw)
  }

  function handleBlur() {
    setTouched(true)
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (cantSubmit) return
    onNext(digitsOnly)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="wizard-cuit" className="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          CUIT del contribuyente
        </label>
        <input
          id="wizard-cuit"
          type="text"
          inputMode="numeric"
          autoFocus
          value={cuit}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder="Ej: 20324837796"
          disabled={disabled}
          className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-base outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
          aria-invalid={showError}
          aria-describedby={showError ? "cuit-error" : undefined}
        />
        {showError && (
          <p id="cuit-error" className="mt-1.5 text-sm text-red-500 dark:text-red-400">
            El CUIT debe tener exactamente 11 dígitos.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={cantSubmit}
        className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {disabled ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Descubriendo cliente...
          </>
        ) : (
          <>
            Continuar
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  )
}
