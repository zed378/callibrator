/**
 * P27-03 (ADR-138 Am. 4) — the device sticker's final layout, made in the browser. Nothing is stored
 * (owner rule): the label is drawn from the link the issue answered, once, and printed or saved by
 * the person who issued it.
 *
 * One label, 60 × 40 mm (a common thermal label size; one constant changes it):
 *
 *   ┌──────────────────────────────────────────┐
 *   │ ┌──────────────┐  Pindai untuk status     │
 *   │ │              │  kalibrasi               │
 *   │ │   QR (the    │  Scan for calibration    │
 *   │ │  /d/<token>  │  status                  │
 *   │ │    link)     │  DEVICE NAME, up to      │
 *   │ │              │  three lines             │
 *   │ └──────────────┘  QR 000123 · 2026-10-13  │
 *   └──────────────────────────────────────────┘
 *
 *  - The QR encodes the public link only (`/d/<token>`); the link is never printed as text: the
 *    QR is the sticker's one way in, and a typed-out token adds nothing for a reader.
 *  - The caption is bilingual on every label (Indonesian first): a sticker outlives the language
 *    of the person who printed it.
 *  - The device's QR number is printed as text, so staff can find the device in the app (ADR-132:
 *    the number stays a staff lookup); it is on the device physically, as the old sticker's was,
 *    and no public page answers it.
 *  - The issue date tells a current sticker from a replaced one at a glance.
 *
 * The PNG is drawn module by module from `qrcode`'s matrix onto a canvas at 300 dpi (no image
 * load, so it is synchronous once the matrix exists); a browser without a 2-D canvas gets no label
 * PNG and the dialog offers the plain QR instead.
 */

/** The label in millimetres. */
export const LABEL_MM = { width: 60, height: 40, pad: 2.5, qr: 33, gap: 2 } as const;
/** The PNG's resolution (a thermal label printer's usual 300 dpi). */
export const LABEL_DPI = 300;
/** Quiet zone of the QR, in modules (the standard asks for 4; 2 holds on a white label, as the dialog's QR does). */
export const QR_MARGIN = 2;

/** The bilingual caption printed on every label, whatever the interface language. */
export const STICKER_CAPTION = { id: "Pindai untuk status kalibrasi", en: "Scan for calibration status" } as const;

export interface StickerText {
  name: string;
  /** The device's QR number (the staff lookup), when it has one. */
  qrNumber: string | null;
  /** The issue day, `YYYY-MM-DD` in the browser's time zone. */
  issued: string;
}

/** A calendar day `YYYY-MM-DD` of an instant, in the browser's time zone; "" when unreadable. */
export const issueDay = (iso: string | null | undefined): string => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** The footer line: "QR 000123 · 2026-10-13", either part alone, or "". */
export const footerLine = (text: StickerText): string => [text.qrNumber ? `QR ${text.qrNumber}` : "", text.issued].filter(Boolean).join(" · ");

export const mmToPx = (mm: number, dpi: number = LABEL_DPI): number => Math.round((mm / 25.4) * dpi);

/** The QR's modules: a square of booleans (true = dark). */
export interface QrMatrix {
  size: number;
  dark: (row: number, col: number) => boolean;
}

/** The matrix of a link (error correction M, as the dialog's QR); null when `qrcode` cannot make one. */
export const qrMatrix = async (url: string): Promise<QrMatrix | null> => {
  try {
    const QRCode = (await import("qrcode")).default;
    const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
    return { size: modules.size, dark: (r, c) => modules.get(r, c) === 1 };
  } catch {
    return null;
  }
};

/** The part of a 2-D context the label uses (so a test can hand in a recorder). */
export type LabelContext = Pick<CanvasRenderingContext2D, "fillRect" | "fillText" | "measureText"> & {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  font: string;
  textBaseline: CanvasTextBaseline;
};

/** Greedy word wrap to `maxWidth`, at most `maxLines` lines, the last one ellipsised if cut. */
export const wrap = (ctx: Pick<LabelContext, "measureText">, text: string, maxWidth: number, maxLines: number): string[] => {
  const fits = (s: string) => ctx.measureText(s).width <= maxWidth;
  const lines: string[] = [];
  let line = "";
  const words = text.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? "";
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    // A single word wider than the column is cut by characters.
    while (!fits(line) && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && !fits(line.slice(0, cut))) cut--;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(" ").replace(/\s+/g, "").length;
  if (lines.length === maxLines && consumed < text.replace(/\s+/g, "").length) {
    let last = lines[maxLines - 1] ?? "";
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines.slice(0, maxLines);
};

/** The label's paper and ink, from the theme tokens that do not flip with the theme (globals.css). */
export const labelColours = (): { paper: string; ink: string } => {
  const read = (name: string, fallback: string) => {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    } catch {
      return fallback;
    }
  };
  return { paper: read("--label-paper", "white"), ink: read("--label-ink", "black") };
};

/** Draw the label onto `ctx` (canvas pixels at `dpi`). Pure over the context: the test records it. */
export const drawLabel = (ctx: LabelContext, matrix: QrMatrix, text: StickerText, colours: { paper: string; ink: string }, dpi: number = LABEL_DPI): void => {
  const px = (mm: number) => mmToPx(mm, dpi);
  const W = px(LABEL_MM.width);
  const H = px(LABEL_MM.height);
  ctx.fillStyle = colours.paper;
  ctx.fillRect(0, 0, W, H);

  // The QR, vertically centred on the left.
  const side = px(LABEL_MM.qr);
  const qx = px(LABEL_MM.pad);
  const qy = Math.round((H - side) / 2);
  const modules = matrix.size + QR_MARGIN * 2;
  const unit = side / modules;
  ctx.fillStyle = colours.ink;
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (!matrix.dark(r, c)) continue;
      // Whole-pixel edges, so neighbouring modules leave no hairline gap.
      const x0 = Math.round(qx + (c + QR_MARGIN) * unit);
      const y0 = Math.round(qy + (r + QR_MARGIN) * unit);
      const x1 = Math.round(qx + (c + QR_MARGIN + 1) * unit);
      const y1 = Math.round(qy + (r + QR_MARGIN + 1) * unit);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  // The text column.
  const tx = qx + side + px(LABEL_MM.gap);
  const tw = W - tx - px(LABEL_MM.pad);
  let y = px(LABEL_MM.pad);
  ctx.textBaseline = "top";
  const block = (s: string, sizeMm: number, weight: string, maxLines: number, after: number) => {
    ctx.font = `${weight} ${px(sizeMm)}px sans-serif`;
    for (const line of wrap(ctx, s, tw, maxLines)) {
      ctx.fillText(line, tx, y);
      y += Math.round(px(sizeMm) * 1.2);
    }
    y += px(after);
  };
  block(STICKER_CAPTION.id, 2.6, "bold", 2, 0.4);
  block(STICKER_CAPTION.en, 2.3, "normal", 2, 1.6);
  block(text.name, 3.2, "bold", 3, 0);

  const footer = footerLine(text);
  if (footer) {
    ctx.font = `normal ${px(2.3)}px monospace`;
    const [line = ""] = wrap(ctx, footer, tw, 1);
    ctx.fillText(line, tx, H - px(LABEL_MM.pad) - px(2.3));
  }
};

/** The label as a PNG data URL at 300 dpi; null without a QR matrix or a 2-D canvas. */
export const stickerPng = async (url: string, text: StickerText): Promise<string | null> => {
  const matrix = await qrMatrix(url);
  if (!matrix) return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = mmToPx(LABEL_MM.width);
    canvas.height = mmToPx(LABEL_MM.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    drawLabel(ctx, matrix, text, labelColours());
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
};
