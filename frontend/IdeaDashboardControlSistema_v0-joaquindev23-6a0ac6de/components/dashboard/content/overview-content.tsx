"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  RefreshCw,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { useSystemData } from "@/hooks/useSystemData";
import { Skeleton } from "@/components/ui/skeleton";

const cardShadow = "rgba(14, 63, 126, 0.04) 0px 0px 0px 1px, rgba(42, 51, 69, 0.04) 0px 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0px 3px 3px -1.5px, rgba(42, 51, 70, 0.04) 0px 6px 6px -3px, rgba(14, 63, 126, 0.04) 0px 12px 12px -6px, rgba(14, 63, 126, 0.04) 0px 24px 24px -12px";

const metricIconMap: Record<string, { icon: typeof AlertTriangle; color: string; bgColor: string }> = {
  "Active Incidents": { icon: AlertTriangle, color: "text-destructive", bgColor: "bg-destructive/10" },
  "Total Runs": { icon: Zap, color: "text-chart-1", bgColor: "bg-chart-1/10" },
  "Error Rate": { icon: Activity, color: "text-success", bgColor: "bg-success/10" },
  "Uptime (30d)": { icon: CheckCircle, color: "text-success", bgColor: "bg-success/10" },
};

function metricTrendColor(metric: { label: string; trend: "up" | "down"; change: string }) {
  // Error Rate going down is good
  if (metric.label === "Error Rate") {
    return metric.trend === "down" ? "text-success" : "text-destructive";
  }
  return metric.trend === "up" ? "text-success" : "text-destructive";
}

function MetricCardSkeleton() {
  return (
    <div
      className="bg-card rounded-2xl p-5 border border-border"
      style={{ boxShadow: cardShadow }}
    >
      <div className="flex items-start justify-between mb-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <Skeleton className="w-16 h-4" />
      </div>
      <Skeleton className="w-20 h-8 mb-1" />
      <Skeleton className="w-24 h-4" />
    </div>
  );
}

function EmptyMetricCard({ label }: { label: string }) {
  return (
    <div
      className="bg-card rounded-2xl p-5 border border-border"
      style={{ boxShadow: cardShadow }}
    >
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-lg text-muted-foreground/60 italic">-</p>
    </div>
  );
}

export function OverviewContent() {
  const {
    requestsData,
    latencyData,
    metrics,
    activeIncidents,
    loading,
    refetching,
    error,
    errors,
    refetch,
  } = useSystemData();

  const [showErrors, setShowErrors] = useState(false);

  // ── Shared empty/loading helpers ──────────────────────────────────────

  function renderChart(
    isLoading: boolean,
    data: unknown[] | null | undefined,
    chart: React.ReactNode,
  ) {
    if (isLoading) return <Skeleton className="w-full h-full rounded-xl" />;
    if (data === null) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          Servicio no disponible
        </div>
      );
    }
    if (data.length === 0) {
      return (
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          No hay datos registrados
        </div>
      );
    }
    return chart;
  }

  return (
    <div className="space-y-6">
      {/* Refresh + Error banner */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={refetch}
            disabled={refetching}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {loading && (
            <span className="text-sm text-muted-foreground">Loading system data...</span>
          )}
        </div>
        {error && (
          <button
            onClick={() => setShowErrors(!showErrors)}
            className="text-xs text-destructive hover:underline"
          >
            {showErrors ? "Hide" : "Show"} connection errors
          </button>
        )}
      </div>

      {showErrors && error && (
        <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          <p className="font-medium mb-1">Connection issues:</p>
          <ul className="list-disc list-inside space-y-0.5 text-xs text-destructive/80">
            {Object.entries(errors)
              .filter(([, v]) => v !== null)
              .map(([key, val]) => (
                <li key={key}>{key}: {val}</li>
              ))}
          </ul>
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <MetricCardSkeleton key={i} />)
          : !metrics
            ? Array.from({ length: 4 }).map((_, i) => (
                <EmptyMetricCard
                  key={i}
                  label={
                    ["Active Incidents", "Total Runs", "Error Rate", "Uptime (30d)"][i]
                  }
                />
              ))
            : metrics.length === 0
              ? Array.from({ length: 4 }).map((_, i) => (
                  <EmptyMetricCard
                    key={i}
                    label={
                      ["Active Incidents", "Total Runs", "Error Rate", "Uptime (30d)"][i]
                    }
                  />
                ))
              : metrics.map((metric) => {
                  const iconConfig = metricIconMap[metric.label] || {
                    icon: Activity,
                    color: "text-muted-foreground",
                    bgColor: "bg-muted",
                  };
                  const Icon = iconConfig.icon;

                  return (
                    <div
                      key={metric.label}
                      className="bg-card rounded-2xl p-5 border border-border"
                      style={{ boxShadow: cardShadow }}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className={`p-2.5 rounded-xl ${iconConfig.bgColor}`}>
                          <Icon className={`w-5 h-5 ${iconConfig.color}`} />
                        </div>
                        <div className={`flex items-center gap-1 text-sm ${metricTrendColor(metric)}`}>
                          {metric.trend === "up" ? (
                            <TrendingUp className="w-4 h-4" />
                          ) : (
                            <TrendingDown className="w-4 h-4" />
                          )}
                          <span className="font-medium">{metric.change}</span>
                        </div>
                      </div>
                      <p className="text-2xl font-semibold text-foreground mb-1">
                        {metric.value}
                      </p>
                      <p className="text-sm text-muted-foreground">{metric.label}</p>
                    </div>
                  );
                })}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Requests Chart */}
        <div
          className="col-span-2 bg-card rounded-2xl p-6 border border-border"
          style={{ boxShadow: cardShadow }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-semibold text-foreground">Request Volume</h3>
              <p className="text-sm text-muted-foreground">Requests per hour</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-chart-1" />
                <span className="text-muted-foreground">Requests</span>
              </div>
            </div>
          </div>
          <div className="h-[240px]">
            {renderChart(
              loading,
              requestsData,
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={requestsData!}>
                  <defs>
                    <linearGradient id="requestsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.55 0.18 250)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="oklch(0.55 0.18 250)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.005 250)" />
                  <XAxis
                    dataKey="time"
                    tick={{ fill: "oklch(0.55 0.01 250)", fontSize: 12 }}
                    axisLine={{ stroke: "oklch(0.92 0.005 250)" }}
                  />
                  <YAxis
                    tick={{ fill: "oklch(0.55 0.01 250)", fontSize: 12 }}
                    axisLine={{ stroke: "oklch(0.92 0.005 250)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid oklch(0.92 0.005 250)",
                      borderRadius: "12px",
                      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="requests"
                    stroke="oklch(0.55 0.18 250)"
                    strokeWidth={2}
                    fill="url(#requestsGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>,
            )}
          </div>
        </div>

        {/* Active Incidents */}
        <div
          className="bg-card rounded-2xl p-6 border border-border"
          style={{ boxShadow: cardShadow }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-foreground">Active Incidents</h3>
            <span className="px-2 py-1 text-xs font-medium bg-destructive/10 text-destructive rounded-full">
              {loading
                ? "..."
                : !activeIncidents
                  ? "0"
                  : `${activeIncidents.length} open`
              }
            </span>
          </div>
          <div className="space-y-3">
            {loading
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-3 rounded-xl bg-muted/50">
                    <div className="flex items-start justify-between mb-2">
                      <Skeleton className="w-14 h-4 rounded-full" />
                      <Skeleton className="w-16 h-3" />
                    </div>
                    <Skeleton className="w-full h-4 mb-2" />
                    <div className="flex items-center justify-between">
                      <Skeleton className="w-16 h-3" />
                      <Skeleton className="w-12 h-3" />
                    </div>
                  </div>
                ))
              : !activeIncidents
                ? (
                  <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
                    Servicio no disponible
                  </div>
                )
                : activeIncidents.length === 0
                  ? (
                    <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
                      No hay incidentes activos
                    </div>
                  )
                  : activeIncidents.map((incident) => (
                      <div
                        key={incident.id}
                        className="p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full ${
                            incident.severity === "critical"
                              ? "bg-destructive/20 text-destructive"
                              : incident.severity === "high"
                                ? "bg-warning/20 text-warning"
                                : "bg-muted-foreground/20 text-muted-foreground"
                          }`}>
                            {incident.severity}
                          </span>
                          <span className="text-xs text-muted-foreground font-mono">{incident.id}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground mb-2 line-clamp-2">
                          {incident.title}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {incident.duration}
                          </div>
                          <span>{incident.assignee}</span>
                        </div>
                      </div>
                    ))}
          </div>
        </div>
      </div>

      {/* Service Latency */}
      <div
        className="bg-card rounded-2xl p-6 border border-border"
        style={{ boxShadow: cardShadow }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-base font-semibold text-foreground">Service Latency</h3>
            <p className="text-sm text-muted-foreground">P50, P95, P99 latency by service (ms)</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-chart-2" />
              <span className="text-muted-foreground">P50</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-chart-1" />
              <span className="text-muted-foreground">P95</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-chart-3" />
              <span className="text-muted-foreground">P99</span>
            </div>
          </div>
        </div>
        <div className="h-[200px]">
          {renderChart(
            loading,
            latencyData,
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={latencyData!} layout="vertical" barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.92 0.005 250)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "oklch(0.55 0.01 250)", fontSize: 12 }}
                  axisLine={{ stroke: "oklch(0.92 0.005 250)" }}
                />
                <YAxis
                  dataKey="service"
                  type="category"
                  tick={{ fill: "oklch(0.55 0.01 250)", fontSize: 12 }}
                  axisLine={{ stroke: "oklch(0.92 0.005 250)" }}
                  width={100}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "white",
                    border: "1px solid oklch(0.92 0.005 250)",
                    borderRadius: "12px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  }}
                />
                <Bar dataKey="p50" fill="oklch(0.65 0.15 155)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="p95" fill="oklch(0.55 0.18 250)" radius={[0, 4, 4, 0]} />
                <Bar dataKey="p99" fill="oklch(0.7 0.18 350)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>,
          )}
        </div>
      </div>
    </div>
  );
}
