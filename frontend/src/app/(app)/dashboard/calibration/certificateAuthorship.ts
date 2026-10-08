import type { Certificate } from "@/api/services/calibration.service";

/**
 * ADR-101 — separation of duties: whether `userId` drafted or submitted the
 * certificate, and so may not approve it (the backend refuses with a 403).
 */
export const isCertificateAuthor = (
  cert: Pick<Certificate, "createdBy" | "submittedBy">,
  userId: string | null | undefined,
): boolean =>
  !!userId && (cert.createdBy === userId || cert.submittedBy === userId);
