/**
 * API client for the fiscal agent chat backend.
 *
 * Sends all messages to POST /v1/chat/message — intent routing happens server-side.
 *
 * Usage:
 *   import apiClient from "./api-client"
 *   const res = await apiClient.sendMessage(token, "consulta CUIT 20324837796")
 *   // => { conversation_id, reply, actions_taken, data }
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || ""

export class ApiError extends Error {
  /**
   * @param {number} status - HTTP status code
   * @param {string} detail - Error detail from the server
   */
  constructor(status, detail) {
    super(`API error ${status}: ${detail}`)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
  }
}

/**
 * Build headers with optional auth token (preferred) or API_KEY fallback.
 * @param {string|null} [token] - Clerk session token
 * @returns {object}
 */
function authHeaders(token) {
  const headers = { "Content-Type": "application/json" }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`
  } else if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`
  }
  return headers
}

const apiClient = {
  /**
   * Send a chat message to the backend and return the structured response.
   *
   * @param {string} [token] - Clerk session token (or falsy to fallback to API_KEY)
   * @param {string} message - Natural language query
   * @param {string|null} [conversationId=null] - Opaque conversation identifier
   * @param {Array<{role: string, content: string}>} [history=[]] - Previous messages
   * @returns {Promise<{conversation_id: string, reply: string, actions_taken: string[], data?: object}>}
   * @throws {Error} AUTH_REQUIRED if token is falsy and no API_KEY fallback
   * @throws {ApiError} On HTTP 4xx/5xx responses
   * @throws {Error} On network timeouts or failures
   */
  async sendMessage(token, message, conversationId = null, history = []) {
    const url = `${API_URL}/v1/chat/message`
    const headers = authHeaders(token)

    const controller = new AbortController()
    // Full pipeline (padrón + calendario + browser extractions + PDF) can take 2+ minutes
    const timeoutId = setTimeout(() => controller.abort(), 180000)

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          conversation_id: conversationId,
          history: history.length > 0 ? history : undefined,
        }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!res.ok) {
        const body = await res.text().catch(() => "")
        throw new ApiError(res.status, body)
      }

      return await res.json()
    } catch (err) {
      clearTimeout(timeoutId)
      if (err instanceof ApiError) throw err
      if (err.name === "AbortError") {
        throw new Error("TIMEOUT")
      }
      throw err
    }
  },

  /**
   * Send a chat message and receive progress via SSE streaming.
   *
   * The stream endpoint sends `progress` events as the pipeline runs,
   * then a `complete` event with the final response.
   *
   * @param {string} [token] - Clerk session token (or falsy to fallback to API_KEY)
   * @param {string} message - Natural language query
   * @param {string|null} [conversationId=null] - Opaque conversation identifier
   * @param {Array<{role: string, content: string}>} [history=[]] - Previous messages
   * @param {object} [opts]
   * @param {(data: {message: string}) => void} [opts.onProgress] - Called per progress event
   * @param {AbortSignal} [opts.signal] - External abort signal
   * @returns {{ promise: Promise<{reply: string, conversation_id: string, data?: object}>, abort: () => void }}
   */
  sendMessageStream(token, message, conversationId = null, history = [], opts = {}) {
    const { onProgress, signal: externalSignal } = opts
    const localController = new AbortController()

    // Combine external + local signals for abort-on-disconnect + timeout
    const signal = externalSignal
      ? AbortSignal.any
        ? AbortSignal.any([externalSignal, localController.signal])
        : externalSignal
      : localController.signal

    const timeoutMs = 180000

    const promise = new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => localController.abort(), timeoutMs)

      try {
        const url = `/api/v1/chat/message/stream`
        const headers = authHeaders(token)

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            message,
            conversation_id: conversationId,
            history: history.length > 0 ? history : undefined,
          }),
          signal,
        })

        clearTimeout(timeoutId)

        if (!res.ok) {
          const body = await res.text().catch(() => "")
          reject(new ApiError(res.status, body))
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let currentEvent = null
        let currentData = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Split on newlines and process complete lines
          const lines = buffer.split("\n")
          buffer = lines.pop() // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith("data: ")) {
              currentData.push(line.slice(6))
            } else if (line === "") {
              // Empty line = end of SSE event
              if (currentEvent && currentData.length > 0) {
                try {
                  const data = JSON.parse(currentData.join("\n"))
                  if (currentEvent === "progress") {
                    onProgress?.(data)
                  } else if (currentEvent === "complete") {
                    resolve(data)
                    return
                  } else if (currentEvent === "error") {
                    reject(new Error(data.detail || "Stream error"))
                    return
                  }
                } catch (parseErr) {
                  // Malformed JSON — skip event
                }
              }
              currentEvent = null
              currentData = []
            }
          }
        }

        // Stream ended without a complete event
        reject(new Error("Stream ended unexpectedly"))
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof ApiError) {
          reject(err)
        } else if (err.name === "AbortError") {
          reject(new Error("ABORTED"))
        } else {
          reject(err)
        }
      }
    })

    return {
      promise,
      abort: () => localController.abort(),
    }
  },

  /**
   * Send a wizard request and receive SSE streaming for pipeline execution.
   *
   * The wizard endpoint has two modes:
   * 1. Discovery (no tasks) → returns JSON with `cliente` info
   * 2. Pipeline (with tasks) → returns SSE with progress + complete events
   *
   * This method handles the SSE case. For discovery, use a plain fetch.
   *
   * @param {string} [token] - Clerk session token
   * @param {{ cuit: string, tasks?: object, conversation_id?: string }} body
   * @param {object} [opts]
   * @param {(data: {state: string, reply: string, cliente?: object}) => void} [opts.onState] - Called per wizard_state event
   * @param {(data: {message: string}) => void} [opts.onProgress] - Called per progress event
   * @param {AbortSignal} [opts.signal] - External abort signal
   * @returns {{ promise: Promise<{reply: string, data?: object, pdf_url?: string, conversation_id: string}>, abort: () => void }}
   */
  sendWizard(token, body, opts = {}) {
    const { onState, onProgress, signal: externalSignal } = opts
    const localController = new AbortController()

    const signal = externalSignal
      ? AbortSignal.any
        ? AbortSignal.any([externalSignal, localController.signal])
        : externalSignal
      : localController.signal

    const timeoutMs = 180000

    const promise = new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => localController.abort(), timeoutMs)

      try {
        const url = `${API_URL}/v1/chat/wizard`
        const headers = authHeaders(token)

        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        })

        clearTimeout(timeoutId)

        if (!res.ok) {
          const body = await res.text().catch(() => "")
          reject(new ApiError(res.status, body))
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let currentEvent = null
        let currentData = []

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split("\n")
          buffer = lines.pop()

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim()
            } else if (line.startsWith("data: ")) {
              currentData.push(line.slice(6))
            } else if (line === "") {
              if (currentEvent && currentData.length > 0) {
                try {
                  const data = JSON.parse(currentData.join("\n"))
                  if (currentEvent === "wizard_state") {
                    onState?.(data)
                  } else if (currentEvent === "progress") {
                    onProgress?.(data)
                  } else if (currentEvent === "complete") {
                    resolve(data)
                    return
                  } else if (currentEvent === "error") {
                    reject(new Error(data.detail || "Wizard error"))
                    return
                  }
                } catch (parseErr) {
                  // Malformed JSON — skip event
                }
              }
              currentEvent = null
              currentData = []
            }
          }
        }

        reject(new Error("Stream ended unexpectedly"))
      } catch (err) {
        clearTimeout(timeoutId)
        if (err instanceof ApiError) {
          reject(err)
        } else if (err.name === "AbortError") {
          reject(new Error("ABORTED"))
        } else {
          reject(err)
        }
      }
    })

    return {
      promise,
      abort: () => localController.abort(),
    }
  },

  // ── Conversation CRUD (stubs for Sprint C) ─────────────────────────

  /**
   * Save a conversation to the backend.
   * @param {string} token - Clerk session token
   * @param {object} data - Conversation data
   * @returns {Promise<object>}
   */
  async saveConversation(token, data) {
    if (!token) throw new Error('AUTH_REQUIRED')
    const url = `${API_URL}/v1/conversations`
    const headers = authHeaders(token)
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ApiError(res.status, body)
    }
    return await res.json()
  },

  /**
   * List all conversations for the current user.
   * @param {string} token - Clerk session token
   * @returns {Promise<Array>}
   */
  async listConversations(token) {
    if (!token) throw new Error('AUTH_REQUIRED')
    const url = `${API_URL}/v1/conversations`
    const headers = authHeaders(token)
    const res = await fetch(url, { headers })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ApiError(res.status, body)
    }
    return await res.json()
  },

  /**
   * Get a single conversation with full messages.
   * @param {string} token - Clerk session token
   * @param {string} id - Conversation ID
   * @returns {Promise<object>}
   */
  async getConversation(token, id) {
    if (!token) throw new Error('AUTH_REQUIRED')
    const url = `/api/v1/conversations/${encodeURIComponent(id)}`
    const headers = authHeaders(token)
    const res = await fetch(url, { headers })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ApiError(res.status, body)
    }
    return await res.json()
  },

  /**
   * Delete a conversation.
   * @param {string} token - Clerk session token
   * @param {string} id - Conversation ID
   * @returns {Promise<void>}
   */
  async deleteConversation(token, id) {
    if (!token) throw new Error('AUTH_REQUIRED')
    const url = `/api/v1/conversations/${encodeURIComponent(id)}`
    const headers = authHeaders(token)
    const res = await fetch(url, { method: 'DELETE', headers })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ApiError(res.status, body)
    }
  },

  // ── API Keys ─────────────────────────────────────────────────────

  async listApiKeys(token) {
    if (!token) throw new Error('AUTH_REQUIRED')
    const url = `${API_URL}/v1/admin/api-keys`
    const headers = authHeaders(token)
    const res = await fetch(url, { headers })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ApiError(res.status, body)
    }
    return res.json()
  },

  async createApiKey(token, scopes) {
    if (!token) throw new Error('AUTH_REQUIRED')
    const url = `${API_URL}/v1/admin/api-keys`
    const headers = authHeaders(token)
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ scopes }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ApiError(res.status, body)
    }
    return res.json()
  },

  async revokeApiKey(token, keyId) {
    if (!token) throw new Error('AUTH_REQUIRED')
    const url = `/api/v1/admin/api-keys/${encodeURIComponent(keyId)}`
    const headers = authHeaders(token)
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...headers, 'Content-Type': 'application/json' },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new ApiError(res.status, body)
    }
  },
}

export default apiClient
