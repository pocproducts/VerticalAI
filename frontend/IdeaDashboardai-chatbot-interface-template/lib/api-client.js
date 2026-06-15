/**
 * API client for the fiscal agent chat backend.
 *
 * Sends all messages to POST /v1/chat/message — intent routing happens server-side.
 *
 * Usage:
 *   import apiClient from "./api-client"
 *   const res = await apiClient.sendMessage("consulta CUIT 20324837796")
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

const apiClient = {
  /**
   * Send a chat message to the backend and return the structured response.
   *
   * @param {string} message - Natural language query
   * @param {string|null} [conversationId=null] - Opaque conversation identifier
   * @param {Array<{role: string, content: string}>} [history=[]] - Previous messages
   * @returns {Promise<{conversation_id: string, reply: string, actions_taken: string[], data?: object}>}
   * @throws {ApiError} On HTTP 4xx/5xx responses
   * @throws {Error} On network timeouts or failures
   */
  async sendMessage(message, conversationId = null, history = []) {
    const url = `${API_URL}/v1/chat/message`
    const headers = {
      "Content-Type": "application/json",
    }

    if (API_KEY) {
      headers["Authorization"] = `Bearer ${API_KEY}`
    }

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
   * @param {string} message - Natural language query
   * @param {string|null} [conversationId=null] - Opaque conversation identifier
   * @param {Array<{role: string, content: string}>} [history=[]] - Previous messages
   * @param {object} [opts]
   * @param {(data: {message: string}) => void} [opts.onProgress] - Called per progress event
   * @param {AbortSignal} [opts.signal] - External abort signal
   * @returns {{ promise: Promise<{reply: string, conversation_id: string, data?: object}>, abort: () => void }}
   */
  sendMessageStream(message, conversationId = null, history = [], opts = {}) {
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
        const url = `${API_URL}/v1/chat/message/stream`
        const headers = { "Content-Type": "application/json" }
        if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`

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
}

export default apiClient
