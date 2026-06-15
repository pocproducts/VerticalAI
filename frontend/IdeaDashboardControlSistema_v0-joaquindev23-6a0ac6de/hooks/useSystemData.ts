"use client";

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api-client";

// ── Types ───────────────────────────────────────────────────────────────

export interface MetricDataPoint {
  time: string;
  requests: number;
  errors: number;
}

export interface LatencyDataPoint {
  service: string;
  p50: number;
  p95: number;
  p99: number;
}

export interface MetricCardData {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down";
}

export interface ActiveIncident {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  duration: string;
  assignee: string;
}

export interface ServiceItem {
  name: string;
  description: string;
  status: "healthy" | "degraded" | "down" | "maintenance";
  version: string;
  uptime: string;
  requests: string;
  errorRate: string;
  latency: string;
  team: string;
  repo: string;
  lastDeploy: string;
}

export interface ActivityItem {
  id: number;
  type: "incident" | "deploy" | "error" | "info";
  title: string;
  time: string;
  status: "active" | "success" | "resolved" | "error";
}

export interface ErrorItem {
  id: number;
  type: string;
  message: string;
  count: number;
  change: string;
  trend: "up" | "down";
  service: string;
  lastSeen: string;
}

export interface ErrorTrendPoint {
  time: string;
  errors: number;
  rate: number;
}

export interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
}

export interface OncallMember {
  id: number;
  name: string;
  role: string;
  initials: string;
  status: "active" | "standby" | "available";
}

// ── Hook ────────────────────────────────────────────────────────────────

export interface SystemDataState {
  /** Request volume time-series data */
  requestsData: MetricDataPoint[] | null;
  /** Latency data per service (P50/P95/P99) */
  latencyData: LatencyDataPoint[] | null;
  /** Summary metric cards for overview */
  metrics: MetricCardData[] | null;
  /** Active incidents */
  activeIncidents: ActiveIncident[] | null;
  /** Services list */
  services: ServiceItem[] | null;
  /** Recent activity feed */
  recentActivity: ActivityItem[] | null;
  /** Error trend time-series */
  errorTrend: ErrorTrendPoint[] | null;
  /** Request funnel stages */
  funnelData: FunnelStage[] | null;
  /** Error summary metrics */
  errorMetrics: MetricCardData[] | null;
  /** Top errors list */
  topErrors: ErrorItem[] | null;
  /** On-call team */
  oncallTeam: OncallMember[] | null;

  /** Overall uptime from health */
  uptime: string | null;
  /** Overall P95 latency */
  p95Latency: string | null;
  /** System operational status */
  systemStatus: string;

  /** Whether any fetch is in progress */
  loading: boolean;
  /** Whether a manual refetch is in progress */
  refetching: boolean;
  /** Global error message (null = no error) */
  error: string | null;
  /** Per-endpoint error details */
  errors: {
    health: string | null;
    metrics: string | null;
    services: string | null;
    activity: string | null;
    errors: string | null;
  };
}

/**
 * useSystemData — fetches all dashboard data on mount.
 *
 * Returns structured data. Each data field is `null` until the endpoint
 * responds. Fields without a backend endpoint remain `null`.
 * Supports manual refetch via refetch().
 */
export function useSystemData(period = "24h"): SystemDataState & {
  refetch: () => void;
} {
  const [state, setState] = useState<SystemDataState>({
    requestsData: null,
    latencyData: null,
    metrics: null,
    activeIncidents: null,
    services: null,
    recentActivity: null,
    errorTrend: null,
    funnelData: null,
    errorMetrics: null,
    topErrors: null,
    oncallTeam: null,
    uptime: null,
    p95Latency: null,
    systemStatus: "Unknown",
    loading: true,
    refetching: false,
    error: null,
    errors: {
      health: null,
      metrics: null,
      services: null,
      activity: null,
      errors: null,
    },
  });

  const [fetching, setFetching] = useState(false);

  const fetchAll = useCallback(
    async (isRefetch = false) => {
      if (fetching) return;
      setFetching(true);

      if (isRefetch) {
        setState((prev) => ({ ...prev, refetching: true }));
      }

      const errors: SystemDataState["errors"] = {
        health: null,
        metrics: null,
        services: null,
        activity: null,
        errors: null,
      };

      // Fetch all endpoints in parallel
      const [healthRes, metricsRes, servicesRes, activityRes, errorsRes] =
        await Promise.allSettled([
          apiClient.getHealth().catch(() => null),
          apiClient.getMetrics(period).catch(() => null),
          apiClient.getServices().catch(() => null),
          apiClient.getActivity(10).catch(() => null),
          apiClient.getErrors(period).catch(() => null),
        ]);

      // ── Process health ──────────────────────────────────────
      let uptime: string | null = null;
      let p95Latency: string | null = null;
      let systemStatus = "Unknown";

      if (healthRes.status === "fulfilled" && healthRes.value) {
        const h = healthRes.value;
        systemStatus = h.status === "healthy" ? "Operational" : "Degraded";
        uptime = h.uptime ? `${(h.uptime * 100).toFixed(2)}%` : null;

        // Derive P95 from health services if available
        if (h.services?.length > 0) {
          const latencies = h.services
            .map((s: any) => s.latency_ms)
            .filter(Boolean)
            .sort((a: number, b: number) => a - b);
          if (latencies.length > 0) {
            const p95Idx = Math.ceil(latencies.length * 0.95) - 1;
            p95Latency = `${latencies[p95Idx]}ms`;
          }
        }
      } else {
        errors.health = "Health endpoint unavailable";
      }

      // ── Process metrics ──────────────────────────────────────
      let requestsData: MetricDataPoint[] | null = null;
      let metrics: MetricCardData[] | null = null;

      if (metricsRes.status === "fulfilled" && metricsRes.value) {
        const m = metricsRes.value;

        // Transform API time_series to chart format
        if (m.time_series && m.time_series.length > 0) {
          requestsData = m.time_series.map((dp: any) => ({
            time: dp.time || dp.timestamp,
            requests: dp.requests ?? dp.total_runs ?? 0,
            errors: dp.errors ?? dp.error_count ?? 0,
          }));
        } else {
          requestsData = [];
        }

        // Derive metric cards from real data
        metrics = [
          {
            label: "Active Incidents",
            value: String(m.active_incidents ?? m.total_runs ?? 0),
            change: `+${m.active_change ?? 0}`,
            trend: "up",
          },
          {
            label: "Total Runs",
            value: String(m.total_runs ?? 0),
            change: `+${m.runs_change ?? 0}`,
            trend: "up",
          },
          {
            label: "Error Rate",
            value: m.error_rate
              ? `${(m.error_rate * 100).toFixed(2)}%`
              : "0%",
            change: `-${m.error_rate_change ?? 0}%`,
            trend: "down",
          },
          {
            label: "Uptime (30d)",
            value: uptime ?? "0%",
            change: `+${m.uptime_change ?? 0}%`,
            trend: "up",
          },
        ];
      } else {
        errors.metrics = "Metrics endpoint unavailable";
      }

      // ── Process services ─────────────────────────────────────
      let services: ServiceItem[] | null = null;

      if (servicesRes.status === "fulfilled" && servicesRes.value) {
        const raw = servicesRes.value;
        if (Array.isArray(raw) && raw.length > 0) {
          services = raw.map((s: any) => ({
            name: s.name ?? s.service ?? "unknown",
            description: s.description ?? "",
            status: s.status ?? "healthy",
            version: s.version ?? "-",
            uptime: s.uptime
              ? typeof s.uptime === "number"
                ? `${(s.uptime * 100).toFixed(2)}%`
                : String(s.uptime)
              : "-",
            requests: s.requests ? String(s.requests) : "-",
            errorRate: s.error_rate
              ? `${(s.error_rate * 100).toFixed(2)}%`
              : "0%",
            latency: s.latency_ms
              ? `${s.latency_ms}ms`
              : s.latency ?? "-",
            team: s.team ?? "-",
            repo: s.repo ?? "",
            lastDeploy: s.last_deploy ?? s.lastDeploy ?? "-",
          }));
        } else {
          services = [];
        }
      } else {
        errors.services = "Services endpoint unavailable";
      }

      // ── Process activity ─────────────────────────────────────
      let recentActivity: ActivityItem[] | null = null;

      if (activityRes.status === "fulfilled" && activityRes.value) {
        const raw = activityRes.value;
        if (Array.isArray(raw) && raw.length > 0) {
          recentActivity = raw.map((a: any, idx: number) => ({
            id: a.id ?? idx + 1,
            type: a.type ?? "info",
            title: a.title ?? a.message ?? a.description ?? "",
            time: a.time ?? a.timestamp ?? a.created_at ?? "",
            status: a.status ?? "success",
          }));
        } else {
          recentActivity = [];
        }
      } else {
        errors.activity = "Activity endpoint unavailable";
      }

      // ── Process errors ───────────────────────────────────────
      let errorTrend: ErrorTrendPoint[] | null = null;
      let topErrors: ErrorItem[] | null = null;
      let errorMetrics: MetricCardData[] | null = null;

      if (errorsRes.status === "fulfilled" && errorsRes.value) {
        const e = errorsRes.value;

        // Trend
        if (e.trend && e.trend.length > 0) {
          errorTrend = e.trend.map((dp: any) => ({
            time: dp.time ?? dp.timestamp,
            errors: dp.errors ?? dp.count ?? 0,
            rate: dp.rate ?? dp.error_rate ?? 0,
          }));
        } else {
          errorTrend = [];
        }

        // Top errors list
        if (e.top_errors && e.top_errors.length > 0) {
          topErrors = e.top_errors.map((err: any) => ({
            id: err.id ?? err.type,
            type: err.type ?? err.exception ?? "Unknown",
            message: err.message ?? err.detail ?? "",
            count: err.count ?? 0,
            change: err.change ?? "0%",
            trend: err.trend ?? "up",
            service: err.service ?? "-",
            lastSeen: err.last_seen ?? err.lastSeen ?? "-",
          }));
        } else {
          topErrors = [];
        }

        // Summary metrics
        errorMetrics = [
          {
            label: "Total Errors (24h)",
            value: (e.total_errors ?? 0).toLocaleString(),
            change: `-${e.error_change ?? 0}%`,
            trend: "down",
          },
          {
            label: "Error Rate",
            value: e.error_rate
              ? `${(e.error_rate * 100).toFixed(2)}%`
              : "0%",
            change: `-${e.rate_change ?? 0}%`,
            trend: "down",
          },
          {
            label: "Unique Errors",
            value: String(e.unique_errors ?? e.unique ?? 0),
            change: `+${e.unique_change ?? 0}`,
            trend: "up",
          },
          {
            label: "Resolved Today",
            value: String(e.resolved_today ?? e.resolved ?? 0),
            change: `+${e.resolved_change ?? 0}`,
            trend: "up",
          },
        ];
      } else {
        errors.errors = "Errors endpoint unavailable";
      }

      // Compute global error
      const globalErrors = Object.values(errors).filter(Boolean);
      const globalError =
        globalErrors.length === Object.keys(errors).length
          ? globalErrors[0]
          : null;

      setState((prev) => ({
        ...prev,
        requestsData,
        latencyData: null,
        metrics,
        activeIncidents: null,
        services,
        recentActivity,
        errorTrend,
        funnelData: null,
        errorMetrics,
        topErrors,
        oncallTeam: null,
        uptime,
        p95Latency,
        systemStatus,
        loading: false,
        refetching: false,
        error: globalError,
        errors,
      }));

      setFetching(false);
    },
    [period],
  );

  useEffect(() => {
    fetchAll(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refetch = useCallback(() => {
    fetchAll(true);
  }, [fetchAll]);

  return {
    ...state,
    refetch,
  };
}
