/**
 * useChat hook — encapsulates chat state, API communication, and LocalStorage persistence.
 *
 * Manages messages[], loading/error state, conversation management, and auto-saves
 * conversations to LocalStorage after each exchange.
 *
 * Usage:
 *   const { messages, loading, error, sendMessage, newConversation, loadHistory, conversations, selectedConversation, selectConversation } = useChat()
 *   await sendMessage("consulta CUIT 20324837796")
 */

import { useCallback, useEffect, useRef, useState } from "react"
import apiClient from "../lib/api-client"

const STORAGE_KEY = "fiscal-chat-conversations"
const MAX_CONVERSATIONS = 50

/**
 * Generate a short unique ID.
 * @returns {string}
 */
function makeId() {
  return Math.random().toString(36).slice(2, 10)
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
  const [conversations, setConversations] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [progressSteps, setProgressSteps] = useState([])
  const initRef = useRef(false)
  const abortRef = useRef(null)

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

  // ── Initialize: load from LocalStorage on mount ─────────────────────

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const stored = loadFromStorage()
    if (stored.length > 0) {
      setConversations(stored)
      // Select the most recent conversation
      const sorted = [...stored].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      setSelectedId(sorted[0].id)
    }
  }, [])

  // ── Auto-save to LocalStorage whenever conversations change ─────────

  useEffect(() => {
    if (!initRef.current) return
    saveToStorage(conversations)
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
          title: text.slice(0, 40),
          updatedAt: now,
          messageCount: 1,
          preview: text.slice(0, 80),
          pinned: false,
          folder: "Work Projects",
          messages: [userMsg],
        }
        setConversations((prev) => [newConv, ...prev])
        setSelectedId(convId)
      } else {
        addMessages(convId, [userMsg])
      }

      // Build history for API
      const currentConv = conversations.find((c) => c.id === convId)
      const history = (currentConv?.messages || []).map((m) => ({
        role: m.role,
        content: m.content,
      }))

      try {
        const { promise, abort } = apiClient.sendMessageStream(
          text,
          convId,
          history,
          {
            onProgress: (data) => {
              setProgressSteps((prev) => processProgress(prev, data.message))
            },
          },
        )

        // Store abort so Pause button can cancel
        abortRef.current = abort

        const response = await promise

        // Create assistant message
        const assistantMsg = {
          id: makeId(),
          role: "assistant",
          content: response.reply,
          createdAt: new Date().toISOString(),
        }

        addMessages(convId, [assistantMsg])
        setProgressSteps([])
      } catch (err) {
        if (err.message === "ABORTED") {
          // User hit Pause — don't show an error, just show what we have
          const partialMsg = {
            id: makeId(),
            role: "assistant",
            content: "⏸️ Consulta cancelada.",
            createdAt: new Date().toISOString(),
          }
          addMessages(convId, [partialMsg])
        } else {
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
    [selectedId, conversations, addMessages, updateConversation],
  )

  // ── abortStream ────────────────────────────────────────────────────

  const abortStream = useCallback(() => {
    abortRef.current?.()
  }, [])

  // ── newConversation ────────────────────────────────────────────────

  const newConversation = useCallback(() => {
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
  }, [])

  // ── selectConversation ─────────────────────────────────────────────

  const selectConversation = useCallback((id) => {
    setSelectedId(id)
    setError(null)
  }, [])

  // ── loadHistory ────────────────────────────────────────────────────

  const loadHistory = useCallback(
    (convId) => {
      const stored = loadFromStorage()
      const conv = stored.find((c) => c.id === convId)
      if (conv) {
        // Merge with current state (keep any unsent messages)
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
    [],
  )

  // ── deleteConversation ─────────────────────────────────────────────

  const deleteConversation = useCallback(
    (convId) => {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== convId)
        if (selectedId === convId) {
          setSelectedId(next.length > 0 ? next[0].id : null)
        }
        return next
      })
    },
    [selectedId],
  )

  // ── renameConversation ─────────────────────────────────────────────

  const renameConversation = useCallback(
    (convId, title) => {
      updateConversation(convId, (c) => ({ ...c, title }))
    },
    [updateConversation],
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
    // Actions
    sendMessage,
    abortStream,
    newConversation,
    selectConversation,
    loadHistory,
    deleteConversation,
    renameConversation,
    setError,
  }
}
