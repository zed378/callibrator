import React from "react";
import Image from "next/image";
import { toSameOriginUpload } from "@/lib/uploadUrl";

interface AvatarProps {
  src?: string;
  alt: string;
  size?: "sm" | "md" | "lg";
  fallback?: string;
  className?: string;
}

const sizeMap: Record<string, string> = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-12 w-12 text-base",
};


export const Avatar: React.FC<AvatarProps> = ({
  src,
  alt,
  size = "md",
  fallback,
  className = "",
}) => {
  const [hasError, setHasError] = React.useState(false);

  const initials = fallback
    ? fallback
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : alt
      ? alt.charAt(0).toUpperCase()
      : "?";

  return (
    <div
      className={`relative rounded-full bg-linear-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold shadow-md shadow-primary/20 ring-2 ring-border ${sizeMap[size]} ${className}`}
    >
      {src && !hasError ? (
        <Image
          src={toSameOriginUpload(src)}
          alt={alt}
          width={100}
          height={100}
          className="h-full w-full rounded-full object-cover"
          onError={() => setHasError(true)}
        />
      ) : (
        <span className="text-white">{initials}</span>
      )}
    </div>
  );
};
