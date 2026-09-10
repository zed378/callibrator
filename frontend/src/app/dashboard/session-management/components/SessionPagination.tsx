import React from "react";
import { Button } from "@/components/ui";

interface SessionPaginationProps {
  currentPage: number;
  totalPages: number;
  totalSessions: number;
  onPrev: () => void;
  onNext: () => void;
}

export const SessionPagination: React.FC<SessionPaginationProps> = ({
  currentPage, totalPages, totalSessions, onPrev, onNext,
}) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2">
      <Button variant="ghost" onClick={onPrev} disabled={currentPage === 1}>Previous</Button>
      <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages} ({totalSessions} total)</span>
      <Button variant="ghost" onClick={onNext} disabled={currentPage === totalPages}>Next</Button>
    </div>
  );
};
