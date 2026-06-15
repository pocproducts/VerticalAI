"use client"
import { useState } from "react"
import { Bot } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

export default function ComposerActionsPopover({ children }) {
  const [open, setOpen] = useState(false)

  const handleAction = () => {
    console.log("Agent mode")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" side="top">
        <div className="p-2 min-w-[200px]">
          <button
            onClick={handleAction}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-sm text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <Bot className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
            <span>Modo agente</span>
            <span className="ml-auto px-2 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded-full font-medium">
              ACTIVO
            </span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
