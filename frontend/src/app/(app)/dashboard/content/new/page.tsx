"use client";

import React from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import PostEditor from "../components/PostEditor";

export default function NewPostPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">New post</h1>
        <PostEditor />
      </div>
    </DashboardLayout>
  );
}
