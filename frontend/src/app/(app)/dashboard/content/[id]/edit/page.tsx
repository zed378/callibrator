"use client";

import React, { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import { Alert } from "@/components/ui";
import PostEditor from "../../components/PostEditor";
import { contentService, type Post } from "@/api/services/content.service";

function EditPostContent() {
  const params = useParams();
  const id = String(params.id);
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    contentService.posts
      .get(id)
      .then(setPost)
      .catch((e) => setError(e instanceof Error ? e.message : "Post not found"))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Edit post</h1>
        {loading && (
          <div className="text-sm text-muted-foreground">Loading…</div>
        )}
        {error && <Alert variant="error">{error}</Alert>}
        {post && <PostEditor initial={post} />}
      </div>
    </DashboardLayout>
  );
}

export default function EditPostPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <EditPostContent />
    </Suspense>
  );
}
