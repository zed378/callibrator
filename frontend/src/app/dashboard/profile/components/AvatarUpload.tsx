"use client";

import React, { useState, useRef, useEffect } from "react";
import { userService } from "@/api/services/user.service";
import { User as UserType } from "@/types";
import { Button, Avatar } from "@/components/ui";
import { useToastStore } from "@/stores/toastStore";
import { Camera, Loader2, Trash2 } from "lucide-react";

// Must mirror the backend route's multer config (user.route.js): 2MB and
// jpeg/png/gif/webp. Allowing more here just produces a server-side rejection.
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];

const AvatarUpload: React.FC<{
  user: UserType;
  avatarUrl: string;
  onAvatarUpload: () => Promise<void>;
  isUploading: boolean;
  setIsUploading: (value: boolean) => void;
}> = ({ user, avatarUrl, onAvatarUpload, isUploading, setIsUploading }) => {
  const [preview, setPreview] = useState<string>(avatarUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToastStore();

  useEffect(() => {
    setTimeout(() => {
      setPreview(avatarUrl);
    }, 0);
  }, [avatarUrl]);

  const resetInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || isUploading) return;

    // Validate against the SERVER's limits and tell the user what's wrong —
    // silently returning made a rejected file look like nothing happened.
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      addToast({
        type: "error",
        title: "Unsupported image type",
        description: "Please choose a JPG, PNG, GIF or WebP image.",
      });
      resetInput();
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      addToast({
        type: "error",
        title: "Image is too large",
        description: `Maximum size is 2MB — this file is ${(
          file.size /
          1024 /
          1024
        ).toFixed(1)}MB.`,
      });
      resetInput();
      return;
    }

    setPreview(URL.createObjectURL(file));
    setIsUploading(true);
    try {
      await userService.uploadAvatar(user.id, file);
      await onAvatarUpload();
      resetInput();
      addToast({ type: "success", title: "Profile picture updated" });
    } catch (err) {
      setPreview(avatarUrl);
      resetInput();
      addToast({
        type: "error",
        title: "Upload failed",
        description:
          err instanceof Error && err.message
            ? err.message
            : "Could not upload the image. Please try again.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteAvatar = async () => {
    try {
      await userService.deleteAvatar(user.id);
      setPreview("");
      await onAvatarUpload();
      resetInput();
      addToast({ type: "success", title: "Profile picture removed" });
    } catch (err) {
      addToast({
        type: "error",
        title: "Could not remove picture",
        description:
          err instanceof Error && err.message ? err.message : "Please try again.",
      });
    }
  };

  const letter = (user.username || user.firstName || "U").charAt(0).toUpperCase();

  return (
    <div className="flex flex-col items-center gap-5">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_AVATAR_TYPES.join(",")}
        onChange={handleFileChange}
        className="hidden"
        aria-label="Upload avatar image file"
      />
      <div
        className="relative group cursor-pointer"
        onClick={() => !isUploading && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <Avatar
          src={preview}
          alt={user.username || user.firstName || "User"}
          fallback={letter}
          size="lg"
          className="!rounded-2xl !w-[112px] !h-[112px] !text-4xl border-2 border-white/10 group-hover:border-primary/30 transition-colors"
        />
        <div className="absolute inset-0 rounded-2xl bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          {isUploading ? (
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          ) : (
            <Camera className="w-5 h-5 text-white" />
          )}
        </div>
      </div>
      <div className="flex gap-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => !isUploading && fileInputRef.current?.click()}
          disabled={isUploading}
          className="gap-2"
          leftIcon={
            isUploading ? (
              <Loader2 className="w-4 h-4" />
            ) : (
              <Camera className="w-4 h-4" />
            )
          }
        >
          {isUploading ? "Uploading..." : "Upload"}
        </Button>
        {preview && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleDeleteAvatar}
            className="gap-2 text-destructive/80 hover:text-destructive border-destructive/20 hover:border-destructive/30"
            leftIcon={<Trash2 className="w-4 h-4" />}
          >
            Remove
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        JPG, PNG, GIF or WebP. Max 2MB.
      </p>
    </div>
  );
};

export default AvatarUpload;
