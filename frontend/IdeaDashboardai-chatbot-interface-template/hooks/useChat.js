/**
 * useChat hook — encapsulates chat state, API communication, and LocalStorage persistence.
 *
 * Manages messages[], loading/error state, conversation management, and auto-saves
 * conversations to LocalStorage after each exchange.
 *
 * Clerk integration: uses useAuth() to get the session token for authenticated API calls.
 * Falls back to LocalStorage when the API is unavailable (progressive migration).
 *
 * Usage:
 *   const { messages, loading, error, sendMessage, newConversation, loadHistory, conversations, selectedConversation, selectConversation } = useChat()
 *   await sendMessage("consulta CUIT 20324837796")
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import apiClient from "../lib/api-client"

const STORAGE_KEY = "fiscal-chat-conversations"
const MIGRATED_KEY = "fiscal-chat-migrated"
const MAX_CONVERSATIONS = 50

/**
 * Generate a short unique ID.
 * @returns {string}
 */
function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

/**
 * Extract an 11-digit CUIT from text (with or without hyphens).
 * @param {string} text
 * @returns {string|null}
 */
function extractCuit(text) {
  const m = text.replace(/-/g, '').match(/\b(\d{11})\b/)
  return m ? m[1] : null
}

/**
 * Load conversations from LocalStorage.
 * @returns {Array}
 */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

/**
 * Save conversations to LocalStorage.
 * @param {Array} conversations
 */
function saveToStorage(conversations) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)))
  } catch {
    // Storage full or unavailable — degrade gracefully
  }
}

/**
 * @typedef {Object} Message
 * @property {string} id
 * @property {"user"|"assistant"} role
 * @property {string} content
 * @property {string} createdAt
 */

/**
 * @typedef {Object} Conversation
 * @property {string} id
 * @property {string} title
 * @property {string} updatedAt
 * @property {number} messageCount
 * @property {string} preview
 * @property {boolean} pinned
 * @property {string} folder
 * @property {Message[]} messages
 */

export default function useChat() {
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [progressSteps, setProgressSteps] = useState([])
  const [latestResult, setLatestResult] = useState(null)
  const [latestPipelineSteps, setLatestPipelineSteps] = useState([])
  const initRef = useRef(false)
  const abortRef = useRef(null)
  const stepsRef = useRef([]) // tracks latest steps for persistence

  /**
   * Classify a progress message for UI styling.
   * @param {string} msg
   * @returns {"in_progress" | "done" | "error" | "warning" | "info"}
   */
  function stepStatus(msg) {
    if (msg.endsWith("...")) return "in_progress"
    if (msg.includes("✅")) return "done"
    if (msg.includes("❌")) return "error"
    if (msg.includes("⚠️")) return "warning"
    return "info"
  }

  /**
   * Process a progress message into the steps array.
   *
   * Console logic:
   * - Messages ending with `...` start a new step → auto-complete previous in_progress
   * - Messages with ✅/❌ mark the current step as done/error
   * - Info/warning messages just append as details of the current step
   *
   * @param {Array<{message:string,status:string}>} prev - Current steps
   * @param {string} msg - Incoming progress message
   * @returns {Array<{message:string,status:string}>}
   */
  function processProgress(prev, msg) {
    const status = stepStatus(msg)

    if (status === "in_progress") {
      // New step → mark all previous in_progress as done
      const updated = prev.map((s) =>
        s.status === "in_progress" ? { ...s, status: "done" } : s,
      )
      return [...updated, { message: msg, status: "in_progress" }]
    }

    if (status === "done" || status === "error") {
      // Completion/error → mark current in_progress as done, add result
      const updated = prev.map((s) =>
        s.status === "in_progress" ? { ...s, status: "done" } : s,
      )
      return [...updated, { message: msg, status }]
    }

    // Info / warning → just append
    return [...prev, { message: msg, status }]
  }

  // ── Initialize: load conversations on mount ─────────────────────────

  useEffect(() => {
    if (!isLoaded) return // Wait for Clerk to finish loading
    if (initRef.current) return

    const load = async () => {
      if (isSignedIn) {
        try {
          const token = await getToken()
          const convs = await apiClient.listConversations(token)
          if (Array.isArray(convs)) {
            if (convs.length > 0) {
              setConversations(convs)
              const sorted = [...convs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
              setSelectedId(sorted[0].id)
            }
            // API responded (even empty) — don't fall back to localStorage
            localStorage.removeItem(STORAGE_KEY)
            initRef.current = true
            return
          }
        } catch {
          // API unavailable — fall through to localStorage
        }
      }

      // Fallback: load from localStorage
      const stored = loadFromStorage()
      if (stored.length > 0) {
        setConversations(stored)
        const sorted = [...stored].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        setSelectedId(sorted[0].id)
      }
      initRef.current = true
    }

    load()
  }, [isLoaded, isSignedIn, getToken])

  // ── Auto-save to LocalStorage whenever conversations change ─────────

  useEffect(() => {
    if (!initRef.current) return
    // Only save to localStorage if not fully migrated
    const migrated = localStorage.getItem(MIGRATED_KEY)
    if (!migrated) {
      saveToStorage(conversations)
    }
  }, [conversations])

  // ── Derived state ──────────────────────────────────────────────────

  const selectedConversation = conversations.find((c) => c.id === selectedId) || null
  const messages = selectedConversation?.messages || []

  // ── Update a conversation in state ─────────────────────────────────

  const updateConversation = useCallback((convId, updater) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c
        const updated = updater(c)
        return { ...updated, updatedAt: new Date().toISOString() }
      }),
    )
  }, [])

  // ── Add messages to a conversation ─────────────────────────────────

  const addMessages = useCallback(
    (convId, newMessages) => {
      updateConversation(convId, (c) => {
        const msgs = [...(c.messages || []), ...newMessages]
        const lastMsg = newMessages[newMessages.length - 1]
        return {
          ...c,
          messages: msgs,
          messageCount: msgs.length,
          preview: lastMsg.content.slice(0, 80),
        }
      })
    },
    [updateConversation],
  )

  // ── sendMessage (streaming) ────────────────────────────────────────

  const sendMessage = useCallback(
    async (text) => {
      if (!text || !text.trim()) return

      setError(null)
      setLoading(true)
      setProgressSteps([])
      setLatestResult(null)
      setLatestPipelineSteps([])

      const now = new Date().toISOString()

      // Create user message
      const userMsg = {
        id: makeId(),
        role: "user",
        content: text,
        createdAt: now,
      }

      // Find or create conversation
      let convId = selectedId

      if (!convId) {
        convId = makeId()
        const newConv = {
          id: convId,
          title: extractCuit(text) ? `Reporte ${extractCuit(text)}` : text.slice(0, 40),
          updatedAt: now,
          messageCount: 1,
          preview: text.slice(0, 80),
          pinned: false,
          folder: "Work Projects",
          messages: [userMsg],
        }
        setConversations((prev) => [newConv, ...prev])
        setSelectedId(convId)

        // Persist new conversation via API (fire-and-forget with fallback)
        if (isSignedIn) {
          try {
            const token = await getToken()
            await apiClient.saveConversation(token, newConv)
          } catch {
            // Fallback: localStorage auto-save handles it
          }
        }
      } else {
        // Update placeholder title with actual user message
        updateConversation(convId, (c) => {
          if (c.title === "New Chat") {
            return { ...c, title: extractCuit(text) ? `Reporte ${extractCuit(text)}` : text.slice(0, 40) }
          }
          return c
        })
        addMessages(convId, [userMsg])
      }

      // Build history for API
      const currentConv = conversations.find((c) => c.id === convId)
      const history = (currentConv?.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      try {
        // Get token for authenticated API call
        const token = isSignedIn ? await getToken() : null

        const { promise, abort } = apiClient.sendMessageStream(
          token,
          text,
          convId,
          history,
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

        // Store abort so Pause button can cancel
        abortRef.current = abort

        const response = await promise

        // Create assistant message with pipeline steps attached
        const steps = stepsRef.current
        const assistantMsg = {
          id: makeId(),
          role: "assistant",
          content: response.reply,
          createdAt: new Date().toISOString(),
          ...(steps.length > 0 ? { pipelineSteps: steps } : {}),
        }

        addMessages(convId, [assistantMsg])
        setLatestResult(response.reply)
        setLatestPipelineSteps(steps)
        stepsRef.current = []
        setProgressSteps([])
      } catch (err) {
        if (err.message === "ABORTED") {
          setLatestResult(null)
          setLatestPipelineSteps([])
          // User hit Pause — don't show an error, just show what we have
          const partialSteps = stepsRef.current
          const partialMsg = {
            id: makeId(),
            role: "assistant",
            content: "⏸️ Consulta cancelada.",
            createdAt: new Date().toISOString(),
            ...(partialSteps.length > 0 ? { pipelineSteps: partialSteps } : {}),
          }
          addMessages(convId, [partialMsg])
          stepsRef.current = []
        } else {
          setLatestResult(null)
          setLatestPipelineSteps([])
          const errorMsg =
            err.message === "TIMEOUT"
              ? "La consulta tardó demasiado. Intentá de nuevo."
              : `Error: ${err.message}`
          setError(errorMsg)
          updateConversation(convId, (c) => ({
            ...c,
            preview: errorMsg.slice(0, 80),
          }))
        }
        setProgressSteps([])
      } finally {
        setLoading(false)
        abortRef.current = null
      }
    },
    [selectedId, conversations, addMessages, updateConversation, isSignedIn, getToken],
  )

  // ── abortStream ────────────────────────────────────────────────────

  const abortStream = useCallback(() => {
    abortRef.current?.()
  }, [])

  // ── newConversation ────────────────────────────────────────────────

  const newConversation = useCallback(async () => {
    const id = makeId()
    const now = new Date().toISOString()
    const newConv = {
      id,
      title: "New Chat",
      updatedAt: now,
      messageCount: 0,
      preview: "Say hello to start...",
      pinned: false,
      folder: "Work Projects",
      messages: [],
    }
    setConversations((prev) => [newConv, ...prev])
    setSelectedId(id)
    setError(null)

    // Persist via API with fallback
    if (isSignedIn) {
      try {
        const token = await getToken()
        await apiClient.saveConversation(token, newConv)
      } catch {
        // Fallback: localStorage auto-save handles it
      }
    }
  }, [isSignedIn, getToken])

  // ── selectConversation ─────────────────────────────────────────────

  const selectConversation = useCallback((id) => {
    setSelectedId(id)
    setError(null)

    // If the selected conversation has no messages loaded, try fetching from API
    // This is handled by the component via loadHistory when needed
  }, [])

  // ── loadHistory ────────────────────────────────────────────────────

  const loadHistory = useCallback(
    async (convId) => {
      // Try API first if signed in
      if (isSignedIn) {
        try {
          const token = await getToken()
          const conv = await apiClient.getConversation(token, convId)
          if (conv && conv.messages) {
            setConversations((prev) =>
              prev.map((c) => (c.id === convId ? { ...c, messages: conv.messages } : c)),
            )
            return
          }
        } catch {
          // API unavailable — fall through to localStorage
        }
      }

      // Fallback: load from localStorage
      const stored = loadFromStorage()
      const conv = stored.find((c) => c.id === convId)
      if (conv) {
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === convId)
          if (existing) {
            return prev.map((c) => (c.id === convId ? { ...c, messages: conv.messages || [] } : c))
          }
          return [conv, ...prev]
        })
        setSelectedId(convId)
      }
    },
    [isSignedIn, getToken],
  )

  // ── deleteConversation ─────────────────────────────────────────────

  const deleteConversation = useCallback(
    async (convId) => {
      // Delete from API first (fire-and-forget with fallback)
      if (isSignedIn) {
        try {
          const token = await getToken()
          await apiClient.deleteConversation(token, convId)
        } catch {
          // Fallback: still delete locally
        }
      }

      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== convId)
        if (selectedId === convId) {
          setSelectedId(next.length > 0 ? next[0].id : null)
        }
        return next
      })
    },
    [selectedId, isSignedIn, getToken],
  )

  // ── onWizardComplete ───────────────────────────────────────────────

  const onWizardComplete = useCallback(
    (convId, reply, wizardData) => {
      const now = new Date().toISOString()
      const assistantMsg = {
        id: makeId(),
        role: "assistant",
        content: reply,
        createdAt: now,
        wizardData: wizardData || null,
      }

      if (selectedId) {
        addMessages(selectedId, [assistantMsg])
      } else {
        // No conversation yet — create one so the wizard result shows up
        const id = makeId()
        const newConv = {
          id,
          title: extractCuit(reply) ? `Reporte ${extractCuit(reply)}` : "Informe fiscal",
          updatedAt: now,
          messageCount: 1,
          preview: reply.slice(0, 80),
          pinned: false,
          folder: "Work Projects",
          messages: [assistantMsg],
        }
        setConversations((prev) => [newConv, ...prev])
        setSelectedId(id)
      }
    },
    [addMessages, selectedId],
  )

  // ── renameConversation ─────────────────────────────────────────────

  const renameConversation = useCallback(
    async (convId, title) => {
      updateConversation(convId, (c) => ({ ...c, title }))

      // Persist via API with fallback
      if (isSignedIn) {
        try {
          const token = await getToken()
          const updated = conversations.find((c) => c.id === convId)
          if (updated) {
            await apiClient.saveConversation(token, { ...updated, title })
          }
        } catch {
          // Fallback: already updated locally
        }
      }
    },
    [updateConversation, isSignedIn, getToken, conversations],
  )

  return {
    // State
    conversations,
    selectedConversation,
    selectedId,
    messages,
    loading,
    error,
    progressSteps,
    latestResult,
    latestPipelineSteps,
    // Clerk auth state (for parent components)
    isLoaded,
    isSignedIn,
    // Actions
    sendMessage,
    abortStream,
    newConversation,
    selectConversation,
    loadHistory,
    deleteConversation,
    renameConversation,
    setError,
    // Wizard callback
    onWizardComplete,
  }
}
