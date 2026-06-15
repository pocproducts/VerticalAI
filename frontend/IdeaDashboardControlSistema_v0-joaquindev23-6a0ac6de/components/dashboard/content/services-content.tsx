"use client";

import { Server, CheckCircle, AlertTriangle, XCircle, ExternalLink, GitBranch, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSystemData } from "@/hooks/useSystemData";

const statusConfig = {
  healthy: { label: "Healthy", color: "text-success", bgColor: "bg-success/10", icon: CheckCircle },
  degraded: { label: "Degraded", color: "text-warning", bgColor: "bg-warning/10", icon: AlertTriangle },
  down: { label: "Down", color: "text-destructive", bgColor: "bg-destructive/10", icon: XCircle },
  maintenance: { label: "Maintenance", color: "text-muted-foreground", bgColor: "bg-muted", icon: Server },
};

const cardShadow = "rgba(14, 63, 126, 0.04) 0px 0px 0px 1px, rgba(42, 51, 69, 0.04) 0px 1px 1px -0.5px, rgba(42, 51, 70, 0.04) 0px 3px 3px -1.5px, rgba(42, 51, 70, 0.04) 0px 6px 6px -3px, rgba(14, 63, 126, 0.04) 0px 12px 12px -6px, rgba(14, 63, 126, 0.04) 0px 24px 24px -12px";

export function ServicesContent() {
  const { services, loading, refetching, refetch } = useSystemData();

  const healthyCount = services?.filter(s => s.status === "healthy").length ?? 0;
  const degradedCount = services?.filter(s => s.status === "degraded").length ?? 0;
  const downCount = services?.filter(s => s.status === "down").length ?? 0;

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
          <span className="text-sm text-muted-foreground">Loading services...</span>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div
          className="bg-card rounded-2xl p-5 border border-border"
          style={{ boxShadow: cardShadow }}
        >
          <p className="text-sm text-muted-foreground mb-1">Total Services</p>
          {loading ? (
            <Skeleton className="w-12 h-8" />
          ) : (
            <p className="text-2xl font-semibold text-foreground">
              {services?.length ?? "-"}
            </p>
          )}
        </div>
        <div
          className="bg-card rounded-2xl p-5 border border-border"
          style={{ boxShadow: cardShadow }}
        >
          <p className="text-sm text-muted-foreground mb-1">Healthy</p>
          {loading ? (
            <Skeleton className="w-12 h-8" />
          ) : (
            <p className="text-2xl font-semibold text-success">{healthyCount}</p>
          )}
        </div>
        <div
          className="bg-card rounded-2xl p-5 border border-border"
          style={{ boxShadow: cardShadow }}
        >
          <p className="text-sm text-muted-foreground mb-1">Degraded</p>
          {loading ? (
            <Skeleton className="w-12 h-8" />
          ) : (
            <p className="text-2xl font-semibold text-warning">{degradedCount}</p>
          )}
        </div>
        <div
          className="bg-card rounded-2xl p-5 border border-border"
          style={{ boxShadow: cardShadow }}
        >
          <p className="text-sm text-muted-foreground mb-1">Down</p>
          {loading ? (
            <Skeleton className="w-12 h-8" />
          ) : (
            <p className="text-2xl font-semibold text-destructive">{downCount}</p>
          )}
        </div>
      </div>

      {/* Services Grid */}
      <div className="grid grid-cols-2 gap-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="bg-card rounded-2xl border border-border p-6"
                style={{ boxShadow: cardShadow }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="w-10 h-10 rounded-xl" />
                    <div>
                      <Skeleton className="w-28 h-4 mb-1" />
                      <Skeleton className="w-36 h-3" />
                    </div>
                  </div>
                  <Skeleton className="w-16 h-5 rounded-full" />
                </div>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <div key={j} className="p-2 rounded-lg bg-muted/50">
                      <Skeleton className="w-full h-3 mb-1" />
                      <Skeleton className="w-12 h-4" />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-border">
                  <Skeleton className="w-48 h-3" />
                  <Skeleton className="w-12 h-6" />
                </div>
              </div>
            ))
          : !services
            ? (
              <div className="col-span-2 flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                Servicio no disponible
              </div>
            )
            : services.length === 0
              ? (
                <div className="col-span-2 flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                  No hay servicios registrados
                </div>
              )
              : services.map((service) => {
                  const status = statusConfig[service.status as keyof typeof statusConfig] || statusConfig.maintenance;
                  const StatusIcon = status.icon;

                  return (
                    <div
                      key={service.name}
                      className="bg-card rounded-2xl border border-border p-6 hover:border-primary/20 transition-colors"
                      style={{ boxShadow: cardShadow }}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", status.bgColor)}>
                            <StatusIcon className={cn("w-5 h-5", status.color)} />
                          </div>
                          <div>
                            <h3 className="font-semibold text-foreground">{service.name}</h3>
                            <p className="text-xs text-muted-foreground">{service.description}</p>
                          </div>
                        </div>
                        <span className={cn(
                          "px-2.5 py-1 text-xs font-medium rounded-full",
                          status.bgColor,
                          status.color
                        )}>
                          {status.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-4 gap-3 mb-4">
                        <div className="p-2 rounded-lg bg-muted/50">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Uptime</p>
                          <p className="text-sm font-semibold text-foreground">{service.uptime}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/50">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Requests</p>
                          <p className="text-sm font-semibold text-foreground">{service.requests}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/50">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Errors</p>
                          <p className="text-sm font-semibold text-foreground">{service.errorRate}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-muted/50">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Latency</p>
                          <p className="text-sm font-semibold text-foreground">{service.latency}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-border">
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3" />
                            {service.version}
                          </span>
                          <span>Team: {service.team}</span>
                          <span>Deployed {service.lastDeploy}</span>
                        </div>
                        <Button variant="ghost" size="sm" className="gap-1 text-xs h-7">
                          <ExternalLink className="w-3 h-3" />
                          View
                        </Button>
                      </div>
                    </div>
                  );
                })}
      </div>
    </div>
  );
}
