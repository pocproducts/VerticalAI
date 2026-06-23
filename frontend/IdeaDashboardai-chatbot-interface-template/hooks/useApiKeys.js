import { useState, useCallback } from 'react'
import { useAuth } from '@clerk/nextjs'
import apiClient from '../lib/api-client'

export default function useApiKeys() {
  const { getToken } = useAuth()
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const listKeys = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const data = await apiClient.listApiKeys(token)
      setKeys(Array.isArray(data) ? data : data?.keys || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  const createKey = useCallback(async (scopes) => {
    const token = await getToken()
    const data = await apiClient.createApiKey(token, scopes)
    await listKeys()
    return data
  }, [getToken, listKeys])

  const revokeKey = useCallback(async (keyId) => {
    const token = await getToken()
    await apiClient.revokeApiKey(token, keyId)
    await listKeys()
  }, [getToken, listKeys])

  return { keys, loading, error, listKeys, createKey, revokeKey }
}
