"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Pencil,
  Plus,
  Tags,
  Trash2,
} from "lucide-react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Button, Alert, Select, Badge, TableSkeleton } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import {
  contentService,
  type Post,
  type PostStatus,
  type PostType,
} from "@/api/services/content.service";
import type { PaginatedResponse } from "@/types";
import CategoriesDialog from "./components/CategoriesDialog";

const TYPE_FILTER = [
  { value: "", label: "All types" },
  { value: "BLOG", label: "Blog" },
  { value: "NEWS", label: "News" },
];
const STATUS_FILTER = [
  { value: "", label: "All statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
];

const statusVariant = (s: PostStatus): "success" | "warning" | "default" =>
  s === "PUBLISHED" ? "success" : s === "DRAFT" ? "warning" : "default";

export default function ContentPage() {
  const router = useRouter();
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState<PaginatedResponse<Post> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [typeF, setTypeF] = useState("");
  const [statusF, setStatusF] = useState("");
  const [catsOpen, setCatsOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await contentService.posts.getAll(page, pageSize, {
        type: (typeF as PostType) || undefined,
        status: (statusF as PostStatus) || undefined,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, [page, typeF, statusF]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const remove = async (id: string) => {
    try {
      await contentService.posts.remove(id);
      addToast({ type: "success", title: "Post deleted" });
      setDeleting(null);
      load();
    } catch (e) {
      addToast({ type: "error", title: e instanceof Error ? e.message : "Delete failed" });
    }
  };

  const posts = data?.data ?? [];
  const totalPages = data?.meta.totalPages ?? 1;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Blog &amp; News</h1>
            <p className="text-sm text-muted-foreground">
              Author and publish the marketing content shown on the public site.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setCatsOpen(true)} className="flex items-center gap-2">
              <Tags className="h-4 w-4" /> Categories
            </Button>
            <Link href="/dashboard/content/new">
              <Button className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> New post
              </Button>
            </Link>
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <div className="flex flex-wrap gap-3">
          <div className="w-40">
            <Select
              value={typeF}
              onChange={(v) => {
                setTypeF(v);
                setPage(1);
              }}
              options={TYPE_FILTER}
            />
          </div>
          <div className="w-44">
            <Select
              value={statusF}
              onChange={(v) => {
                setStatusF(v);
                setPage(1);
              }}
              options={STATUS_FILTER}
            />
          </div>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={5} />
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center text-muted-foreground">
            No posts yet — create your first one.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">Title</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Categories</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {posts.map((p) => {
                  const base = p.type === "BLOG" ? "blog" : "news";
                  return (
                    <tr key={p.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{p.title}</div>
                        <div className="text-xs text-muted-foreground">
                          /{base}/{p.slug}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="info" size="sm">
                          {p.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={statusVariant(p.status)} size="sm">
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(p.categories ?? []).slice(0, 3).map((c) => (
                            <Badge key={c.id} variant="default" size="sm">
                              {c.name}
                            </Badge>
                          ))}
                          {(p.categories ?? []).length > 3 && (
                            <span className="text-xs text-muted-foreground">
                              +{(p.categories ?? []).length - 3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {p.status === "PUBLISHED" && (
                            <a
                              href={`/${base}/${p.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              title="View on site"
                              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                          <button
                            onClick={() => router.push(`/dashboard/content/${p.id}/edit`)}
                            title="Edit"
                            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {deleting === p.id ? (
                            <span className="flex items-center gap-1">
                              <button
                                onClick={() => remove(p.id)}
                                className="rounded-lg bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setDeleting(null)}
                                className="rounded-lg px-2 py-1 text-xs text-muted-foreground"
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setDeleting(p.id)}
                              title="Delete"
                              className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <CategoriesDialog isOpen={catsOpen} onClose={() => setCatsOpen(false)} onChanged={load} />
      </div>
    </DashboardLayout>
  );
}
