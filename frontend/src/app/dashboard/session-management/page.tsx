"use client";

import React, { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { useAuthStore } from "@/stores/authStore";
import { sessionService, Session as ApiServiceSession } from "@/api/services/session.service";
import { Button } from "@/components/ui";
import { RefreshCw, LogOut, Monitor, Activity, Clock, Shield, AlertTriangle } from "lucide-react";
import SessionStatCard from "./components/StatCard";
import { SessionFilters } from "./components/SessionFilters";
import SessionRow from "./components/SessionRow";
import { ConfirmationModal } from "./components/ConfirmationModal";
import { SessionPagination } from "./components/SessionPagination";

interface Session extends ApiServiceSession {
  isCurrentSession?: boolean;
}

interface SessionStatsLocal {
  total: number;
  active: number;
  expired: number;
  revoked: number;
  currentUserId: string | null;
}

export default function SessionManagementPage() {
  const { user, isAuthenticated, fetchUser } = useAuthStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<SessionStatsLocal | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalSessions, setTotalSessions] = useState(0);
  const LIMIT = 20;

  const fetchSessions = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    setIsLoading(true);
    try {
      const statusMap: Record<string, "active" | "expired" | "revoked" | undefined> = { all: undefined, active: "active", expired: "expired", revoked: "revoked" };
      const response = await sessionService.getAll(page, LIMIT, searchQuery || undefined, statusMap[filterStatus]);
      const currentUserId = user.id;
      const sessionsWithFlags = response.data.sessions.map((s: ApiServiceSession) => ({
        ...s, isCurrentSession: s.userId === currentUserId && s.status === "active",
      }));
      setSessions(sessionsWithFlags);
      setTotalPages(response.data.meta.totalPages);
      setTotalSessions(response.data.meta.total);
      const apiSessions = response.data.sessions;
      setStats({
        total: response.data.meta.total,
        active: apiSessions.filter((s: ApiServiceSession) => s.status === "active").length,
        expired: apiSessions.filter((s: ApiServiceSession) => s.status === "expired").length,
        revoked: apiSessions.filter((s: ApiServiceSession) => s.status === "revoked").length,
        currentUserId,
      });
    } catch { /* ignore */ }
    finally { setIsLoading(false); }
  }, [isAuthenticated, user, page, LIMIT, searchQuery, filterStatus]);

  const fetchStats = useCallback(async () => {
    if (!isAuthenticated || !user) return;
    try {
      const statsData = await sessionService.getStats();
      setStats((prev) => ({ ...(prev || { total: 0, active: 0, expired: 0, revoked: 0, currentUserId: user.id }), ...statsData }));
    } catch { /* ignore */ }
  }, [isAuthenticated, user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchUser();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchUser]);

  useEffect(() => {
    if (isAuthenticated && user) {
      const timer = setTimeout(() => {
        fetchSessions();
        fetchStats();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isAuthenticated, user, page, searchQuery, filterStatus, fetchSessions, fetchStats]);

  const handleRevokeSession = async (sessionId: string) => {
    try { await sessionService.revoke(sessionId, "MANUAL_REVOKE"); setSessions((p) => p.filter((s) => s.id !== sessionId)); }
    catch { /* ignore */ }
    finally { setRevokeConfirm(null); }
    await fetchSessions(); await fetchStats();
  };
  const handleDeleteSession = async (sessionId: string) => {
    try { await sessionService.delete(sessionId); setSessions((p) => p.filter((s) => s.id !== sessionId)); }
    catch { /* ignore */ }
    finally { setDeleteConfirm(null); }
    await fetchSessions(); await fetchStats();
  };
  const handleRevokeAll = async () => { if (!user?.id) return; await sessionService.revokeAllForUser(user.id, "USER_REVOKE_ALL_OTHERS"); await fetchSessions(); await fetchStats(); };
  const handleRefresh = async () => { setPage(1); await fetchSessions(); await fetchStats(); };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Session Management</h1>
            <p className="text-sm mt-1 text-muted-foreground">Manage your active sessions across devices</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="ghost" onClick={handleRevokeAll}>
              <LogOut className="w-4 h-4 text-destructive" />
              Revoke All Others
            </Button>
          </div>
        </div>

        {stats && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <SessionStatCard title="Total Sessions" value={stats.total} icon={<Monitor className="w-6 h-6 text-primary" />} bgColor="bg-primary/10" />
            <SessionStatCard title="Active Sessions" value={stats.active} icon={<Activity className="w-6 h-6 text-success" />} bgColor="bg-success/10" />
            <SessionStatCard title="Expired Sessions" value={stats.expired} icon={<Clock className="w-6 h-6 text-destructive" />} bgColor="bg-destructive/10" />
            <SessionStatCard title="Revoked Sessions" value={stats.revoked} icon={<Shield className="w-6 h-6 text-muted-foreground" />} bgColor="bg-muted0/10" />
          </div>
        )}

        <SessionFilters searchQuery={searchQuery} onSearchChange={setSearchQuery} filterStatus={filterStatus} onFilterChange={setFilterStatus} />

        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-10 w-10 border-t-primary border-4 border-transparent" />
                <p className="text-sm">Loading sessions...</p>
              </div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-2xl bg-card p-12 text-center shadow-sm">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="font-medium text-muted-foreground">No sessions found</p>
              <p className="text-sm mt-1 text-muted-foreground">Try adjusting your search or filter criteria</p>
            </div>
          ) : (
            sessions.map((session) => (
              <SessionRow key={session.id} session={session} onRevoke={(id) => setRevokeConfirm(id)} onDelete={(id) => setDeleteConfirm(id)} />
            ))
          )}
        </div>

        <SessionPagination currentPage={page} totalPages={totalPages} totalSessions={totalSessions} onPrev={() => setPage((p) => Math.max(1, p - 1))} onNext={() => setPage((p) => Math.min(totalPages, p + 1))} />

        <ConfirmationModal show={!!revokeConfirm} onConfirm={() => revokeConfirm && handleRevokeSession(revokeConfirm)} onCancel={() => setRevokeConfirm(null)} type="revoke" />
        <ConfirmationModal show={!!deleteConfirm} onConfirm={() => deleteConfirm && handleDeleteSession(deleteConfirm)} onCancel={() => setDeleteConfirm(null)} type="delete" />
      </div>
    </DashboardLayout>
  );
}
