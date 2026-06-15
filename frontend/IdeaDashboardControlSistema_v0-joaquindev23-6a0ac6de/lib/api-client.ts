/**
 * API client for the fiscal agent system monitoring backend.
 *
 * Typed methods for all dashboard endpoints.
 * Uses NEXT_PUBLIC_API_URL (proxy endpoint or direct).
 *
 * Usage:
 *   import { apiClient } from "@/lib/api-client"
 *   const health = await apiClient.getHealth()
 */

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(`API error ${status}: ${detail}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

const API_URL: string =
  (typeof window !== "undefined"
    ? (window as any).__NEXT_PUBLIC_API_URL
    : undefined) ||
  process.env.NEXT_PUBLIC_API_URL ||
  "/api";

const API_KEY: string =
  (typeof window !== "undefined"
    ? (window as any).__NEXT_PUBLIC_API_KEY
    : undefined) ||
  process.env.NEXT_PUBLIC_API_KEY ||
  "";

const TIMEOUT_MS = 15_000;

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (API_KEY) {
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string>) },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ApiError(res.status, body);
    }

    return (await res.json()) as T;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw err;
  }
}

export const apiClient = {
  /** GET /v1/health — system health check with per-service status */
  getHealth: () => request<any>("/v1/health"),

  /** GET /v1/system/metrics?period= — pipeline metrics */
  getMetrics: (period = "24h") =>
    request<any>(`/v1/system/metrics?period=${encodeURIComponent(period)}`),

  /** GET /v1/system/services — per-service status, uptime, latency */
  getServices: () => request<any[]>("/v1/system/services"),

  /** GET /v1/system/activity?limit=&offset= — recent activity feed */
  getActivity: (limit = 10, offset = 0) =>
    request<any[]>(
      `/v1/system/activity?limit=${limit}&offset=${offset}`,
    ),

  /** GET /v1/system/errors?period=&severity=&service= — system errors */
  getErrors: (
    period = "24h",
    severity?: string,
    service?: string,
  ) => {
    const params = new URLSearchParams({ period });
    if (severity) params.set("severity", severity);
    if (service) params.set("service", service);
    return request<any>(`/v1/system/errors?${params.toString()}`);
  },
};
