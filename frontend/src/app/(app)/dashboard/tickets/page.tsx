"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The bare /dashboard/tickets route is not a page of its own — raising is the
 * default entry point. Redirect to it so old links keep working.
 */
export default function TicketsIndexPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/tickets/raise");
  }, [router]);
  return null;
}
