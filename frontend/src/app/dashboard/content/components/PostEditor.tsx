"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Star,
  Trash2,
  XCircle,
} from "lucide-react";
import { Button, Input, Textarea, Select, MultiSelect } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import RichTextEditor from "@/components/editor/RichTextEditor";
import { attachmentService } from "@/api/services/attachment.service";
import {
  contentService,
  type Post,
  type PostInput,
  type Category,
} from "@/api/services/content.service";

const TYPE_OPTIONS = [
  { value: "BLOG", label: "Blog article" },
  { value: "NEWS", label: "News item" },
];
const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PUBLISHED", label: "Published" },
  { value: "ARCHIVED", label: "Archived" },
];

const Panel = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-2xl border border-border bg-card p-6">{children}</div>
);

// Mirrors the backend slugify so the preview matches what will be stored.
const clientSlugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);

interface SlugStatus {
  checking: boolean;
  available: boolean | null;
  suggestion?: string;
}

export default function PostEditor({ initial }: { initial?: Post }) {
  const router = useRouter();
  const addToast = useToastStore((s) => s.addToast);
  const [categories, setCategories] = useState<Category[]>([]);
  const [saving, setSaving] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);

  // When editing, the slug already exists — treat it as manually set so a title
  // edit doesn't silently rewrite the URL. New posts auto-derive it from title.
  const slugManual = useRef<boolean>(!!initial);
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slugStatus, setSlugStatus] = useState<SlugStatus>({
    checking: false,
    available: null,
  });

  const [form, setForm] = useState<PostInput>({
    type: initial?.type ?? "BLOG",
    title: initial?.title ?? "",
    slug: initial?.slug ?? "",
    excerpt: initial?.excerpt ?? "",
    coverImageUrl: initial?.coverImageUrl ?? "",
    contentHtml: initial?.contentHtml ?? "",
    status: initial?.status ?? "DRAFT",
    authorName: initial?.authorName ?? "",
    authorRole: initial?.authorRole ?? "",
    featured: initial?.featured ?? false,
    categoryIds: initial?.categories?.map((c) => c.id) ?? [],
  });

  useEffect(() => {
    contentService.categories.getAll().then(setCategories).catch(() => {});
  }, []);

  function set<K extends keyof PostInput>(k: K, v: PostInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Debounced backend slug-availability check (mirrors the username check in
  // the users module). Runs from change handlers, not an effect.
  function runSlugCheck(slug: string) {
    if (slugTimer.current) clearTimeout(slugTimer.current);
    const s = slug.trim();
    if (!s) {
      setSlugStatus({ checking: false, available: null });
      return;
    }
    setSlugStatus({ checking: true, available: null });
    slugTimer.current = setTimeout(async () => {
      try {
        const res = await contentService.posts.checkSlug(s, initial?.id);
        setSlugStatus({ checking: false, available: res.available, suggestion: res.suggestion });
      } catch {
        setSlugStatus({ checking: false, available: null });
      }
    }, 350);
  }

  useEffect(() => () => { if (slugTimer.current) clearTimeout(slugTimer.current); }, []);

  function handleTitleChange(title: string) {
    set("title", title);
    if (!slugManual.current) {
      const s = clientSlugify(title);
      set("slug", s);
      runSlugCheck(s);
    }
  }

  function handleSlugChange(slug: string) {
    slugManual.current = true;
    set("slug", slug);
    runSlugCheck(slug);
  }

  function applySuggestion(s: string) {
    slugManual.current = true;
    set("slug", s);
    runSlugCheck(s);
  }

  async function handleCover(file: File) {
    setCoverUploading(true);
    try {
      const res = await attachmentService.upload({ file, resourceType: "post" });
      const url = (res as unknown as { url?: string }).url;
      if (url) set("coverImageUrl", url);
      else addToast({ type: "error", title: "Cover upload returned no URL" });
    } catch {
      addToast({ type: "error", title: "Cover upload failed" });
    } finally {
      setCoverUploading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      addToast({ type: "error", title: "Title is required" });
      return;
    }
    setSaving(true);
    try {
      if (initial) await contentService.posts.update(initial.id, form);
      else await contentService.posts.create(form);
      addToast({ type: "success", title: initial ? "Post updated" : "Post created" });
      router.push("/dashboard/content");
      router.refresh();
    } catch (err) {
      addToast({ type: "error", title: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  const catOptions = categories.map((c) => ({ value: c.id, label: c.name }));

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={() => router.push("/dashboard/content")}
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All content
        </button>
        <div className="flex items-center gap-3">
          <Button type="submit" isLoading={saving}>
            {form.status === "PUBLISHED" ? "Publish" : "Save"}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 lg:col-span-2">
          <Panel>
            <div className="space-y-4">
              <Input
                label="Title"
                value={form.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Every device calibrated…"
              />
              <div>
                <Input
                  label="Slug (auto-generated from title)"
                  value={form.slug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  placeholder="every-device-calibrated"
                />
                {(slugStatus.checking || slugStatus.available !== null) && (
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    {slugStatus.checking ? (
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Checking availability…
                      </span>
                    ) : slugStatus.available ? (
                      <span className="flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> &ldquo;{form.slug}&rdquo; is available
                      </span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2 text-destructive">
                        <span className="flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5" /> That slug is taken
                        </span>
                        {slugStatus.suggestion && slugStatus.suggestion !== form.slug && (
                          <button
                            type="button"
                            onClick={() => applySuggestion(slugStatus.suggestion!)}
                            className="font-semibold text-primary hover:underline"
                          >
                            Use &ldquo;{slugStatus.suggestion}&rdquo;
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <Textarea
                label="Excerpt"
                value={form.excerpt}
                onChange={(e) => set("excerpt", e.target.value)}
                rows={2}
                placeholder="One or two lines shown on cards and in search results."
              />
            </div>
          </Panel>

          <Panel>
            <label className="mb-2 block text-sm font-medium text-foreground">Body</label>
            <RichTextEditor
              value={form.contentHtml || ""}
              onChange={(html) => set("contentHtml", html)}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Paste text and images straight from a document — pasted images upload automatically.
            </p>
          </Panel>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Panel>
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Type</label>
                <Select
                  value={form.type}
                  onChange={(v) => set("type", v as PostInput["type"])}
                  options={TYPE_OPTIONS}
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-foreground">Status</label>
                <Select
                  value={form.status || "DRAFT"}
                  onChange={(v) => set("status", v as PostInput["status"])}
                  options={STATUS_OPTIONS}
                />
              </div>
              <button
                type="button"
                onClick={() => set("featured", !form.featured)}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                  form.featured
                    ? "bg-primary/10 text-primary ring-1 ring-primary/40"
                    : "text-muted-foreground ring-1 ring-border hover:bg-muted"
                }`}
              >
                <Star className={`h-4 w-4 ${form.featured ? "fill-primary" : ""}`} />
                {form.featured ? "Featured" : "Mark as featured"}
              </button>
            </div>
          </Panel>

          <Panel>
            <label className="mb-2 block text-sm font-medium text-foreground">Categories</label>
            <MultiSelect
              value={form.categoryIds || []}
              onChange={(ids) => set("categoryIds", ids)}
              options={catOptions}
              placeholder="Select one or more…"
              emptyMessage="No categories yet — create some first."
            />
          </Panel>

          <Panel>
            <label className="mb-2 block text-sm font-medium text-foreground">Cover image</label>
            {form.coverImageUrl ? (
              <div className="relative overflow-hidden rounded-xl border border-border">
                <div className="relative aspect-video w-full">
                  {/* Plain img: CMS URLs are host-relative /uploads (rewritten to the API). */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.coverImageUrl} alt="Cover" className="h-full w-full object-cover" />
                </div>
                <button
                  type="button"
                  onClick={() => set("coverImageUrl", "")}
                  className="absolute right-2 top-2 rounded-lg bg-black/60 p-1.5 text-white hover:bg-black/80"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-sm text-muted-foreground hover:bg-muted/50">
                {coverUploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ImagePlus className="h-5 w-5" />
                )}
                <span>{coverUploading ? "Uploading…" : "Upload a cover image"}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCover(f);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </Panel>

          <Panel>
            <div className="space-y-4">
              <Input
                label="Author name"
                value={form.authorName}
                onChange={(e) => set("authorName", e.target.value)}
                placeholder="HDC Team"
              />
              <Input
                label="Author role"
                value={form.authorRole}
                onChange={(e) => set("authorRole", e.target.value)}
                placeholder="Compliance"
              />
            </div>
          </Panel>
        </div>
      </div>
    </form>
  );
}
