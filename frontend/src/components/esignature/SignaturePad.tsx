"use client";
/**
 * P21-15 (ADR-140; spec v2 § 5) — draw a signature (pointer, pen and touch) or upload an image, and
 * hand back the specimen as SVG the backend's allow-list accepts: a drawing becomes `<path>` strokes;
 * an uploaded PNG or JPEG is embedded as one data-URI `<image>` (≤ 180 KB, so the specimen stays under
 * the 256 KB limit). Nothing is sent from here: the parent saves it with a re-entered credential.
 */
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui";
import { Eraser, Upload } from "lucide-react";

const WIDTH = 600;
const HEIGHT = 200;
/** The largest uploaded image (bytes) — its base64 data URI stays under the specimen's 256 KB limit. */
export const MAX_UPLOAD_BYTES = 180 * 1024;

type Point = readonly [number, number];

const round = (n: number): string => String(Math.round(n * 10) / 10);

/** Strokes as the specimen SVG (paths only). */
export const strokesToSvg = (strokes: readonly (readonly Point[])[]): string => {
  const paths = strokes
    .filter((s) => s.length > 0)
    .map((s) => {
      const [first, ...rest] = s as [Point, ...Point[]];
      const d = [`M${round(first[0])} ${round(first[1])}`, ...(rest.length ? rest : [first]).map(([x, y]) => `L${round(x)} ${round(y)}`)].join(" ");
      return `<path d="${d}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}"><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
};

/** An uploaded image's data URI as the specimen SVG. */
export const imageToSvg = (dataUri: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(WIDTH)} ${String(HEIGHT)}"><image href="${dataUri}" x="0" y="0" width="${String(WIDTH)}" height="${String(HEIGHT)}" preserveAspectRatio="xMidYMid meet"/></svg>`;

export function SignaturePad({ onChange }: { onChange: (svg: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const pointOf = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - box.left) / (box.width || WIDTH)) * WIDTH, ((e.clientY - box.top) / (box.height || HEIGHT)) * HEIGHT];
  };

  const paint = (): void => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // The ink is the theme's text colour (the stored specimen uses currentColor: black in an image).
    ctx.strokeStyle = canvas.current ? getComputedStyle(canvas.current).color : "currentColor";
    for (const stroke of strokes.current) {
      ctx.beginPath();
      stroke.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.stroke();
    }
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawing.current = true;
    strokes.current.push([pointOf(e)]);
    paint();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing.current) return;
    strokes.current[strokes.current.length - 1]?.push(pointOf(e));
    paint();
  };
  const up = (): void => {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(strokesToSvg(strokes.current));
  };
  const clear = (): void => {
    strokes.current = [];
    paint();
    setUploadError(null);
    onChange(null);
  };

  const upload = (file: File | undefined): void => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setUploadError("Choose a PNG or JPEG image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError("The image is larger than 180 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUploadError(null);
      onChange(imageToSvg(String(reader.result)));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvas}
        width={WIDTH}
        height={HEIGHT}
        aria-label="Signature drawing area: draw your signature with a mouse, pen or finger"
        role="img"
        className="w-full touch-none rounded-md border border-border bg-card text-foreground"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear}>
          <Eraser className="mr-1 h-4 w-4" aria-hidden="true" /> Clear
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm">
          <Upload className="h-4 w-4" aria-hidden="true" /> Upload an image
          <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>
      {uploadError && (
        <p role="alert" className="text-xs text-destructive">
          {uploadError}
        </p>
      )}
    </div>
  );
}

export default SignaturePad;
