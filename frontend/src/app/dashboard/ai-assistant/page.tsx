// src/app/dashboard/ai-assistant/page.tsx
"use client";

import React, { useRef, useState } from "react";
import DashboardLayout from "@/components/layouts/DashboardLayout";
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  FormField,
  Textarea,
} from "@/components/ui";
import { FileSearch, Send, Sparkles, Upload } from "lucide-react";
import { aiService, type CertificateOcrResult } from "@/api/services/ai.service";
import { useToastStore } from "@/stores/toastStore";

export default function AiAssistantPage() {
  const addToast = useToastStore((s) => s.addToast);
  const fileRef = useRef<HTMLInputElement>(null);

  // RAG
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  // OCR
  const [ocr, setOcr] = useState<CertificateOcrResult | null>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await aiService.query(question.trim());
      setAnswer(res.answer);
    } catch (err) {
      addToast({
        type: "error",
        title: "Query failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAsking(false);
    }
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setOcr(null);
    setOcrBusy(true);
    try {
      const result = await aiService.ocr(file);
      setOcr(result);
      addToast({ type: "success", title: "Certificate scanned" });
    } catch (err) {
      addToast({
        type: "error",
        title: "OCR failed",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setOcrBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const ocrRows: Array<[string, string | undefined]> = ocr
    ? [
        ["Certificate #", ocr.certificateNumber],
        ["Calibration date", ocr.calibrationDate],
        ["Due date", ocr.dueDate],
        ["Vendor", ocr.vendorName],
        ["Device serial", ocr.deviceSerialNumber],
        ["Status", ocr.status],
      ]
    : [];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Assistant</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions grounded in your organisation&apos;s documents, and
            extract fields from calibration certificates.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* RAG Q&A */}
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  Knowledge Base Q&amp;A
                </span>
              }
            />
            <CardContent className="space-y-4">
              <FormField
                label="Question"
                helperText="Answered only from documents ingested for your tenant."
              >
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  rows={3}
                  placeholder="e.g. What is the calibration interval for pressure gauges?"
                />
              </FormField>
              <Button
                onClick={ask}
                isLoading={asking}
                disabled={!question.trim()}
                leftIcon={<Send className="h-4 w-4" />}
              >
                Ask
              </Button>
              {answer !== null && (
                <Alert variant="info">
                  <span className="whitespace-pre-wrap">{answer}</span>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Certificate OCR */}
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <FileSearch className="h-5 w-5 text-primary" />
                  Certificate OCR
                </span>
              }
            />
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload a certificate image or PDF to extract its key fields.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={onFile}
              />
              <Button
                variant="outline"
                onClick={() => fileRef.current?.click()}
                isLoading={ocrBusy}
                leftIcon={<Upload className="h-4 w-4" />}
              >
                {fileName ? `Re-scan (${fileName})` : "Upload certificate"}
              </Button>

              {ocr && (
                <div className="rounded-md border border-border divide-y divide-border">
                  {ocrRows.map(([label, value]) => (
                    <div
                      key={label}
                      className="flex justify-between px-3 py-2 text-sm"
                    >
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-medium">{value || "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
