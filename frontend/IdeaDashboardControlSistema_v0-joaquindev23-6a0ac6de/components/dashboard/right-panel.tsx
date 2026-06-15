"use client";

import { Activity, Clock, AlertTriangle, CheckCircle, XCircle, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSystemData } from "@/hooks/useSystemData";
import { Skeleton } from "@/components/ui/skeleton";

export function RightPanel() {
  const {
    recentActivity,
    uptime,
    p95Latency,
    systemStatus,
    loading,
  } = useSystemData();

  return (
    <aside className="w-[280px] h-screen bg-card border-l border-border flex flex-col shrink-0 overflow-hidden">
      {/* System Status */}
      <div className="p-5 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground">System Status</h3>
          <span className={`flex items-center gap-1.5 text-xs font-medium ${
            systemStatus === "Operational" ? "text-success" : "text-warning"
          }`}>
            <span className={`w-2 h-2 ${
              systemStatus === "Operational" ? "bg-success" : "bg-warning"
            } rounded-full animate-pulse`} />
            {systemStatus}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-muted/50">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">Uptime</p>
            {loading ? (
              <Skeleton className="w-14 h-6" />
            ) : (
              <p className="text-lg font-semibold text-foreground">{uptime ?? "-"}</p>
            )}
          </div>
          <div className="p-3 rounded-xl bg-muted/50">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-1">P95 Latency</p>
            {loading ? (
              <Skeleton className="w-14 h-6" />
            ) : (
              <p className="text-lg font-semibold text-foreground">{p95Latency ?? "-"}</p>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="p-5 border-b border-border">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          Recent Activity
        </h3>
        <div className="space-y-3">
          {loading
            ? Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 p-2 -mx-2">
                  <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Skeleton className="w-32 h-4 mb-1" />
                    <Skeleton className="w-20 h-3" />
                  </div>
                </div>
              ))
            : !recentActivity
              ? (
                <div className="flex items-center justify-center h-[120px] text-sm text-muted-foreground">
                  Servicio no disponible
                </div>
              )
              : recentActivity.length === 0
                ? (
                  <div className="flex items-center justify-center h-[120px] text-sm text-muted-foreground">
                    No hay actividad reciente
                  </div>
                )
                : recentActivity.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="w-full flex items-start gap-3 p-2 -mx-2 rounded-lg hover:bg-muted/60 transition-colors text-left group"
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                        item.status === "active"
                          ? "bg-destructive/10"
                          : item.status === "success"
                            ? "bg-success/10"
                            : "bg-muted"
                      )}>
                        {item.type === "incident" ? (
                          item.status === "active" ? (
                            <AlertTriangle className="w-4 h-4 text-destructive" />
                          ) : (
                            <CheckCircle className="w-4 h-4 text-success" />
                          )
                        ) : item.status === "success" ? (
                          <CheckCircle className="w-4 h-4 text-success" />
                        ) : item.status === "error" || item.status === "active" ? (
                          <AlertTriangle className="w-4 h-4 text-destructive" />
                        ) : (
                          <CheckCircle className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {item.title}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {item.time}
                        </p>
                      </div>
                    </button>
                  ))}
        </div>
      </div>

      {/* On-Call Team — placeholder para futura integración */}
      <div className="p-5 flex-1 overflow-y-auto">
        <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          On-Call Team
        </h3>
        <div className="flex items-center justify-center h-[120px] text-sm text-muted-foreground border border-dashed border-border rounded-xl">
          Próximamente
        </div>
      </div>
    </aside>
  );
}
