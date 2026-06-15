"use client";

import { Bug, TrendingUp, TrendingDown, AlertTriangle, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useSystemData } from "@/hooks/useSystemData";
import { Skeleton } from "@/components/ui/skeleton";

const cardShadow = "rgba(14, 63, 126, 0.04) 0px 0px 0px 1px, rgba(42, 51, 69, 0.04) 0px 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0px 3px 3px -1.5px, rgba(42, 51, 70, 0.04) 0px 6px 6px -3px, rgba(14, 63, 126, 0.04) 0px 12px 12px -6px, rgba(14, 63, 126, 0.04) 0px 24px 24px -12px";

function ErrorMetricSkeleton() {
  return (
    <div className="bg-card rounded-2xl p-5 border border-border" style={{ boxShadow: cardShadow }}>
      <Skeleton className="w-24 h-4 mb-1" />
      <Skeleton className="w-16 h-8 mb-1" />
      <Skeleton className="w-12 h-3" />
    </div>
  );
}

function EmptyMetricCard({ label }: { label: string }) {
  return (
    <div className="bg-card rounded-2xl p-5 border border-border" style={{ boxShadow: cardShadow }}>
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-lg text-muted-foreground/60 italic">-</p>
    </div>
  );
}

export function ErrorsContent() {
  const {
    errorTrend,
    funnelData,
    errorMetrics,
    topErrors,
    loading,
    refetching,
    refetch,
  } = useSystemData();

  // ── Shared empty/loading helper for charts ────────────────────────────

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
      {/* Refresh */}
      <div className="flex items-center justify-between">
        <button
          onClick={refetch}
          disabled={refetching}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
        {loading && (
          <span className="text-sm text-muted-foreground">Loading error data...</span>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <ErrorMetricSkeleton key={i} />)
          : !errorMetrics
            ? Array.from({ length: 4 }).map((_, i) => (
                <EmptyMetricCard
                  key={i}
                  label={
                    ["Total Errors (24h)", "Error Rate", "Unique Errors", "Resolved Today"][i]
                  }
                />
              ))
            : errorMetrics.length === 0
              ? Array.from({ length: 4 }).map((_, i) => (
                  <EmptyMetricCard
                    key={i}
                    label={
                      ["Total Errors (24h)", "Error Rate", "Unique Errors", "Resolved Today"][i]
                    }
                  />
                ))
              : errorMetrics.map((metric) => (
                  <div
                    key={metric.label}
                    className="bg-card rounded-2xl p-5 border border-border"
                    style={{ boxShadow: cardShadow }}
                  >
                    <p className="text-sm text-muted-foreground mb-1">{metric.label}</p>
                    <div className="flex items-end justify-between">
                      <p className="text-2xl font-semibold text-foreground">{metric.value}</p>
                      <span className={`text-sm font-medium ${
                        metric.trend === "down" ? "text-success" : "text-destructive"
                      }`}>
                        {metric.change}
                      </span>
                    </div>
                  </div>
                ))}
      </div>

      {/* Charts Row — error trend always visible; funnel only when data exists */}
      <div className={`grid gap-6 ${funnelData ? "grid-cols-2" : "grid-cols-1"}`}>
        {/* Error Trend */}
        <div
          className="bg-card rounded-2xl p-6 border border-border"
          style={{ boxShadow: cardShadow }}
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-semibold text-foreground">Error Trend</h3>
              <p className="text-sm text-muted-foreground">Errors over time</p>
            </div>
          </div>
          <div className="h-[220px]">
            {renderChart(
              loading,
              errorTrend,
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={errorTrend!}>
                  <defs>
                    <linearGradient id="errorGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.6 0.2 25)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="oklch(0.6 0.2 25)" stopOpacity={0} />
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
                    dataKey="errors"
                    stroke="oklch(0.6 0.2 25)"
                    strokeWidth={2}
                    fill="url(#errorGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>,
            )}
          </div>
        </div>

        {/* Request Funnel — only renders when data exists */}
        {funnelData && funnelData.length > 0 && (
          <div
            className="bg-card rounded-2xl p-6 border border-border"
            style={{ boxShadow: cardShadow }}
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-base font-semibold text-foreground">Request Funnel</h3>
                <p className="text-sm text-muted-foreground">Request processing pipeline</p>
              </div>
            </div>
            <div className="space-y-3">
              {(() => {
                const maxCount = funnelData[0].count;
                return funnelData.map((stage, index) => {
                  const widthPercentage = (stage.count / maxCount) * 100;
                  const dropoff = index > 0
                    ? ((funnelData[index - 1].count - stage.count) / funnelData[index - 1].count * 100).toFixed(2)
                    : null;

                  return (
                    <div key={stage.stage}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm font-medium text-foreground">{stage.stage}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {stage.count.toLocaleString()}
                          </span>
                          {dropoff && Number(dropoff) > 0 && (
                            <span className="text-xs text-destructive">
                              -{dropoff}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="h-8 bg-muted rounded-lg overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-lg transition-all duration-500",
                            index === funnelData.length - 1
                              ? "bg-success"
                              : "bg-chart-1"
                          )}
                          style={{ width: `${widthPercentage}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Top Errors */}
      <div
        className="bg-card rounded-2xl border border-border"
        style={{ boxShadow: cardShadow }}
      >
        <div className="p-6 border-b border-border">
          <h3 className="text-base font-semibold text-foreground">Top Errors</h3>
          <p className="text-sm text-muted-foreground">Most frequent errors in the last 24 hours</p>
        </div>
        <div className="divide-y divide-border">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-4 flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Skeleton className="w-28 h-4" />
                      <Skeleton className="w-20 h-3 rounded-full" />
                    </div>
                    <Skeleton className="w-48 h-3" />
                  </div>
                  <Skeleton className="w-16 h-8" />
                  <Skeleton className="w-16 h-3" />
                </div>
              ))
            : !topErrors
              ? (
                <div className="p-10 flex items-center justify-center text-sm text-muted-foreground">
                  Servicio no disponible
                </div>
              )
              : topErrors.length === 0
                ? (
                  <div className="p-10 flex items-center justify-center text-sm text-muted-foreground">
                    No hay errores registrados
                  </div>
                )
                : topErrors.map((error) => (
                    <div
                      key={error.id}
                      className="p-4 hover:bg-muted/30 transition-colors cursor-pointer flex items-center gap-4"
                    >
                      <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center shrink-0">
                        <Bug className="w-5 h-5 text-destructive" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-foreground font-mono text-sm">{error.type}</span>
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-muted rounded-full text-muted-foreground">
                            {error.service}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{error.message}</p>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-lg font-semibold text-foreground">{error.count}</p>
                          <p className={cn(
                            "text-xs font-medium flex items-center justify-end gap-0.5",
                            error.trend === "up" ? "text-destructive" : "text-success"
                          )}>
                            {error.trend === "up" ? (
                              <TrendingUp className="w-3 h-3" />
                            ) : (
                              <TrendingDown className="w-3 h-3" />
                            )}
                            {error.change}
                          </p>
                        </div>
                        <div className="text-right w-20">
                          <p className="text-xs text-muted-foreground">{error.lastSeen}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </div>
                    </div>
                  ))}
        </div>
      </div>
    </div>
  );
}
