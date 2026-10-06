/** @jest-environment jsdom */
/**
 * P10-17 (ADR-118) — the warm landing's client islands and server pieces:
 *
 *  - TimeGreeting: the day part from the visitor's clock (Indonesian buckets);
 *  - HeroPointer: writes −1…1 to two CSS variables on a fine pointer, resets on
 *    leave, and does nothing under reduced motion or a coarse pointer;
 *  - QrVerifyDemo: idle → scanning → the "SAH" verdict after SCAN_MS, announced
 *    in a live region; at once under reduced motion; "again" resets;
 *  - DemoQr: a real QR matrix for the sample text (finder patterns present),
 *    with an accessible name, never a link;
 *  - WorkflowStory: the observer moves the active step, the rail and the
 *    panel's micro-animation; every step's fx renders.
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TimeGreeting, partOfDay } from "../TimeGreeting";
import { HeroPointer } from "../HeroPointer";
import { QrVerifyDemo, SCAN_MS, type QrVerifyDemoLabels } from "../QrVerifyDemo";
import { DemoQr, DEMO_QR_TEXT, qrPath } from "../DemoQr";
import { BeforeAfter } from "../BeforeAfter";
import { CertificateExplorer, nearestSlide } from "../CertificateExplorer";
import { StepFx, WorkflowStory, type WorkflowStep, type WorkflowStepId } from "../WorkflowStory";

type MediaMap = Record<string, boolean>;
const mockMedia = (map: MediaMap) => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: Boolean(map[query]),
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
};

describe("TimeGreeting", () => {
  it("maps the hour to the Indonesian day parts", () => {
    expect([3, 4, 10, 11, 14, 15, 17, 18, 23].map(partOfDay)).toEqual([
      "evening",
      "morning",
      "morning",
      "midday",
      "midday",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
    ]);
  });

  it("shows the visitor's day part on the client", () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 5, 8, 30));
    const words = { default: "Halo", morning: "Selamat pagi", midday: "Selamat siang", afternoon: "Selamat sore", evening: "Selamat malam" };
    const { container, unmount } = render(<TimeGreeting words={words} />);
    expect(container.textContent).toBe("Selamat pagi");
    unmount();
    jest.useRealTimers();
  });
});

/** jsdom has no PointerEvent with coordinates; a MouseEvent of that type carries them. */
const move = (el: HTMLElement, clientX: number, clientY: number) =>
  act(() => {
    el.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY, bubbles: true }));
  });

describe("HeroPointer", () => {
  const rect = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
  let raf: jest.SpyInstance;
  beforeEach(() => {
    raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      // Synchronous for the test; returns 0 so the island's "frame pending"
      // flag, assigned after this returns, reads as no frame pending.
      cb(0);
      return 0;
    });
  });
  afterEach(() => raf.mockRestore());

  it("follows a fine pointer within −1…1 and returns to 0 on leave", () => {
    mockMedia({ "(prefers-reduced-motion: no-preference)": true, "(pointer: fine)": true });
    render(
      <HeroPointer>
        <span>child</span>
      </HeroPointer>,
    );
    const el = screen.getByTestId("hero-pointer");
    el.getBoundingClientRect = () => rect as DOMRect;
    move(el, 200, 0);
    expect(el.style.getPropertyValue("--lp-px")).toBe("1.000");
    expect(el.style.getPropertyValue("--lp-py")).toBe("-1.000");
    move(el, 500, 50);
    expect(el.style.getPropertyValue("--lp-px")).toBe("1.000");
    act(() => {
      el.dispatchEvent(new MouseEvent("pointerleave"));
    });
    expect(el.style.getPropertyValue("--lp-px")).toBe("0.000");
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("ignores a zero-size box", () => {
    mockMedia({ "(prefers-reduced-motion: no-preference)": true, "(pointer: fine)": true });
    render(<HeroPointer>x</HeroPointer>);
    const el = screen.getByTestId("hero-pointer");
    el.getBoundingClientRect = () => ({ ...rect, width: 0 }) as DOMRect;
    move(el, 10, 10);
    expect(el.style.getPropertyValue("--lp-px")).toBe("");
  });

  it("does nothing under reduced motion or on a touch pointer", () => {
    mockMedia({ "(prefers-reduced-motion: no-preference)": false, "(pointer: fine)": true });
    render(<HeroPointer>x</HeroPointer>);
    const el = screen.getByTestId("hero-pointer");
    el.getBoundingClientRect = () => rect as DOMRect;
    move(el, 200, 0);
    expect(el.style.getPropertyValue("--lp-px")).toBe("");
  });

  it("cancels a pending frame on unmount", () => {
    raf.mockImplementation(() => 7);
    const cancel = jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    mockMedia({ "(prefers-reduced-motion: no-preference)": true, "(pointer: fine)": true });
    const { unmount } = render(<HeroPointer>x</HeroPointer>);
    const el = screen.getByTestId("hero-pointer");
    el.getBoundingClientRect = () => rect as DOMRect;
    move(el, 50, 50);
    unmount();
    expect(cancel).toHaveBeenCalledWith(7);
    cancel.mockRestore();
  });
});

const labels: QrVerifyDemoLabels = {
  scan: "Pindai kode QR",
  scanning: "Memindai…",
  again: "Ulangi",
  idle: "Ponsel auditor siap memindai.",
  sample: "Demonstrasi dengan contoh data",
  phoneLabel: "Layar ponsel auditor",
  verdict: "SAH",
  verdictLead: "Sertifikat ini tercatat pada sistem penerbit.",
  certNumber: "Nomor sertifikat",
  device: "Alat",
  validUntil: "Berlaku hingga",
};
const certificate = { number: "CERT-20261005-CONTOH-0001", device: "Pompa infus · CONTOH-0142", validUntil: "5 Oktober 2027" };

describe("QrVerifyDemo", () => {
  afterEach(() => jest.useRealTimers());

  it("scans, then shows and announces the verdict; 'again' resets", () => {
    jest.useFakeTimers();
    mockMedia({ "(prefers-reduced-motion: reduce)": false });
    render(<QrVerifyDemo labels={labels} certificate={certificate} qr={<svg aria-label="qr" />} certificateTitle="Sertifikat" />);
    expect(screen.getByText(labels.idle)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: labels.scan });
    fireEvent.click(button);
    expect(screen.getByRole("status")).toHaveTextContent(labels.scanning);
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button); // ignored while scanning
    act(() => {
      jest.advanceTimersByTime(SCAN_MS);
    });
    expect(screen.getByRole("status")).toHaveTextContent(`${labels.verdict}. ${labels.verdictLead}`);
    expect(screen.getByText(certificate.device)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: labels.again }));
    expect(screen.getByText(labels.idle)).toBeInTheDocument();
  });

  it("under reduced motion the verdict appears at once", () => {
    mockMedia({ "(prefers-reduced-motion: reduce)": true });
    render(<QrVerifyDemo labels={labels} certificate={certificate} qr={<svg aria-label="qr" />} certificateTitle="Sertifikat" />);
    fireEvent.click(screen.getByRole("button", { name: labels.scan }));
    expect(screen.getByText(labels.verdict, { selector: ".lp-verdict-word" })).toBeInTheDocument();
  });

  it("clears a pending scan when it unmounts", () => {
    jest.useFakeTimers();
    mockMedia({});
    const clear = jest.spyOn(window, "clearTimeout");
    const { unmount } = render(
      <QrVerifyDemo labels={labels} certificate={certificate} qr={<svg aria-label="qr" />} certificateTitle="Sertifikat" />,
    );
    fireEvent.click(screen.getByRole("button", { name: labels.scan }));
    unmount();
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });
});

describe("DemoQr", () => {
  it("draws a real QR matrix for the sample text, named, not a link", () => {
    const { size, d } = qrPath(DEMO_QR_TEXT);
    expect(size).toBeGreaterThanOrEqual(21);
    // The top-left finder pattern: a dark 7-module row at y = 0.
    for (let x = 0; x < 7; x += 1) expect(d).toContain(`M${x} 0h1v1h-1z`);
    const { container } = render(<DemoQr label="Kode QR contoh" />);
    expect(screen.getByRole("img", { name: "Kode QR contoh" })).toBeInTheDocument();
    expect(container.querySelector("a")).toBeNull();
    expect(DEMO_QR_TEXT).toMatch(/CONTOH DATA/);
  });
});

describe("WorkflowStory", () => {
  const ids: WorkflowStepId[] = ["device", "schedule", "calibrate", "certificate", "sign", "verify"];
  const steps: WorkflowStep[] = ids.map((id, i) => ({
    id,
    number: String(i + 1).padStart(2, "0"),
    title: `Title ${id}`,
    text: `Text ${id}`,
    fx: `Fx ${id}`,
    progress: `Langkah ${i + 1} dari 6`,
    image: { src: `/marketing/product/step-${id}.webp`, alt: `Alt ${id}`, width: 1280, height: 800 },
  }));

  it("renders every step's micro-animation label", () => {
    for (const id of ids) {
      const { container, unmount } = render(<StepFx id={id} label={`Fx ${id}`} />);
      expect(container.textContent).toContain(`Fx ${id}`);
      expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
      unmount();
    }
  });

  it("follows the step crossing the viewport's middle: panel, progress, rail", () => {
    let callback: IntersectionObserverCallback = () => undefined;
    const disconnect = jest.fn();
    (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = jest.fn((cb: IntersectionObserverCallback) => {
      callback = cb;
      return { observe: jest.fn(), disconnect, unobserve: jest.fn(), takeRecords: () => [] };
    });
    const { container, unmount } = render(<WorkflowStory steps={steps} caption="Contoh data" label="Alur kerja" />);
    expect(screen.getByText("Langkah 1 dari 6")).toBeInTheDocument();
    const third = container.querySelector('li[data-index="2"]') as HTMLElement;
    act(() => {
      callback(
        [
          { isIntersecting: false, target: third } as unknown as IntersectionObserverEntry,
          { isIntersecting: true, target: third } as unknown as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
      );
    });
    expect(screen.getByText("Langkah 3 dari 6")).toBeInTheDocument();
    expect(third).toHaveAttribute("data-active", "true");
    expect(container.querySelector('li[data-index="0"]')).toHaveAttribute("data-done", "true");
    expect((container.querySelector(".lp-rail") as HTMLElement).style.getPropertyValue("--lp-progress")).toBe("0.5");
    expect(screen.getAllByText("Fx calibrate").length).toBeGreaterThan(0);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });

  it("renders without an IntersectionObserver (static list)", () => {
    const saved = (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    delete (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
    render(<WorkflowStory steps={steps} caption="Contoh data" label="Alur kerja" />);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(6);
    (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = saved;
  });
});

describe("BeforeAfter", () => {
  it("is a named range that moves the divide", () => {
    const img = { src: "/a.webp", width: 10, height: 10 };
    const { container } = render(
      <BeforeAfter
        sliderLabel="Geser untuk membandingkan"
        valueText="{before}% sebelum, {after}% sesudah"
        before={{ ...img, alt: "Sebelum", label: "Sebelum" }}
        after={{ ...img, src: "/b.webp", alt: "Sesudah", label: "Sesudah" }}
      />,
    );
    const range = screen.getByRole("slider", { name: "Geser untuk membandingkan" });
    expect(range).toHaveValue("50");
    fireEvent.change(range, { target: { value: "20" } });
    expect((container.querySelector(".lp-ba") as HTMLElement).style.getPropertyValue("--lp-ba")).toBe("20%");
    expect(range).toHaveAttribute("aria-valuetext", "20% sebelum, 80% sesudah");
  });
});

describe("CertificateExplorer", () => {
  const spots = [
    { title: "Dari catatan alat", text: "Teks satu" },
    { title: "Dari catatan kalibrasi", text: "Teks dua" },
    { title: "Tanda tangan", text: "Teks tiga" },
    { title: "Kode QR", text: "Teks empat" },
  ];
  const fields = [
    { label: "Fasilitas", value: "Rumah Sakit Contoh" },
    { label: "Alat", value: "Pompa infus", spot: 0 },
    { label: "Standar", value: "Contoh", spot: 1 },
    { label: "Ditandatangani", value: "Contoh", spot: 2 },
  ];
  const slideLabels = spots.map((_, i) => `Penjelasan ${i + 1} dari 4`);
  const renderExplorer = () =>
    render(
      <CertificateExplorer
        docTitle="Sertifikat"
        number="CERT-X"
        fields={fields}
        spots={spots}
        qr={<svg aria-label="qr" />}
        verified="SAH"
        sample="Contoh data"
        spotLabel="Penanda"
        slideLabels={slideLabels}
        carouselLabel="Penjelasan bagian sertifikat"
      />,
    );
  const live = () => document.querySelector('[aria-live="polite"]') as HTMLElement;

  /** jsdom lays nothing out: give the track a scroll position and the slides offsets. */
  const layout = (track: HTMLElement) => {
    const slides = Array.from(track.querySelectorAll<HTMLElement>(".lp-spot-slide"));
    slides.forEach((el, i) => Object.defineProperty(el, "offsetLeft", { configurable: true, value: i * 300 }));
    const calls: Array<{ left?: number; behavior?: string }> = [];
    (track as unknown as { scrollTo: (o: { left?: number; behavior?: string }) => void }).scrollTo = (o) => {
      calls.push(o);
      Object.defineProperty(track, "scrollLeft", { configurable: true, value: o.left ?? 0 });
    };
    return calls;
  };

  let raf: jest.SpyInstance;
  beforeEach(() => {
    raf = jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    mockMedia({ "(prefers-reduced-motion: reduce)": false });
  });
  afterEach(() => raf.mockRestore());

  it("nearestSlide picks the slide whose left edge is closest", () => {
    expect(nearestSlide(0, [0, 300, 600])).toBe(0);
    expect(nearestSlide(160, [0, 300, 600])).toBe(1);
    expect(nearestSlide(900, [0, 300, 600])).toBe(2);
  });

  it("markers: click, focus and hover activate and scroll the track to their slide", () => {
    renderExplorer();
    const track = screen.getByRole("group", { name: "Penjelasan bagian sertifikat" });
    const calls = layout(track);
    const markers = screen.getAllByRole("button", { name: /Penanda/ });
    expect(markers).toHaveLength(4);
    expect(markers[0]).toHaveAttribute("aria-pressed", "true");
    expect(live()).toHaveTextContent("Penjelasan 1 dari 4: Dari catatan alat. Teks satu");
    fireEvent.click(markers[1]);
    expect(calls.at(-1)).toEqual({ left: 300, behavior: "smooth" });
    expect(live()).toHaveTextContent("Teks dua");
    fireEvent.focus(markers[2]);
    expect(live()).toHaveTextContent("Teks tiga");
    fireEvent.mouseEnter(markers[3]);
    expect(markers[3]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Contoh data")).toBeInTheDocument();
  });

  it("swiping the track makes the slide in view active (markers and dashes follow)", () => {
    renderExplorer();
    const track = screen.getByRole("group", { name: "Penjelasan bagian sertifikat" });
    layout(track);
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 610 });
    fireEvent.scroll(track);
    expect(live()).toHaveTextContent("Penjelasan 3 dari 4: Tanda tangan");
    expect(screen.getAllByRole("button", { name: /Penanda/ })[2]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Penjelasan 3 dari 4" })).toHaveAttribute("aria-current", "step");
  });

  it("a programmatic scroll ignores the slides it passes until it reaches its target", () => {
    renderExplorer();
    const track = screen.getByRole("group", { name: "Penjelasan bagian sertifikat" });
    const slides = Array.from(track.querySelectorAll<HTMLElement>(".lp-spot-slide"));
    slides.forEach((el, i) => Object.defineProperty(el, "offsetLeft", { configurable: true, value: i * 300 }));
    // A smooth scroll that has not arrived yet: scrollTo does not move scrollLeft.
    (track as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    fireEvent.click(screen.getByRole("button", { name: "Penjelasan 4 dari 4" }));
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 300 });
    fireEvent.scroll(track); // passing slide 2 on the way
    expect(live()).toHaveTextContent("Penjelasan 4 dari 4");
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 900 });
    fireEvent.scroll(track); // arrived
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 600 });
    fireEvent.scroll(track); // a later swipe back is followed again
    expect(live()).toHaveTextContent("Penjelasan 3 dari 4");
  });

  it("dashes are named buttons; arrow keys move one slide; reduced motion scrolls instantly", () => {
    mockMedia({ "(prefers-reduced-motion: reduce)": true });
    renderExplorer();
    const track = screen.getByRole("group", { name: "Penjelasan bagian sertifikat" });
    const calls = layout(track);
    const dashes = slideLabels.map((name) => screen.getByRole("button", { name }));
    expect(dashes[0]).toHaveAttribute("aria-current", "step");
    fireEvent.click(dashes[2]);
    expect(calls.at(-1)).toEqual({ left: 600, behavior: "auto" });
    fireEvent.keyDown(track, { key: "ArrowRight" });
    expect(live()).toHaveTextContent("Penjelasan 4 dari 4");
    fireEvent.keyDown(track, { key: "ArrowRight" }); // stays on the last
    expect(live()).toHaveTextContent("Penjelasan 4 dari 4");
    fireEvent.keyDown(track, { key: "ArrowLeft" });
    expect(live()).toHaveTextContent("Penjelasan 3 dari 4");
    fireEvent.keyDown(track, { key: "Enter" });
    expect(live()).toHaveTextContent("Penjelasan 3 dari 4");
  });

  it("activating the slide already in view holds no target, so the next swipe is still followed (QA M2)", () => {
    renderExplorer();
    const track = screen.getByRole("group", { name: "Penjelasan bagian sertifikat" });
    const calls = layout(track);
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 0 });
    fireEvent.click(screen.getAllByRole("button", { name: /Penanda 1/ })[0]); // slide 1 is already shown
    expect(calls).toHaveLength(0);
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 300 });
    fireEvent.scroll(track); // the visitor swipes
    expect(live()).toHaveTextContent("Penjelasan 2 dari 4");
  });

  it("an interrupted programmatic scroll releases its hold after a moment", () => {
    jest.useFakeTimers();
    renderExplorer();
    const track = screen.getByRole("group", { name: "Penjelasan bagian sertifikat" });
    const slides = Array.from(track.querySelectorAll<HTMLElement>(".lp-spot-slide"));
    slides.forEach((el, i) => Object.defineProperty(el, "offsetLeft", { configurable: true, value: i * 300 }));
    (track as unknown as { scrollTo: () => void }).scrollTo = () => undefined;
    fireEvent.click(screen.getByRole("button", { name: "Penjelasan 4 dari 4" }));
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    Object.defineProperty(track, "scrollLeft", { configurable: true, value: 300 });
    fireEvent.scroll(track);
    act(() => {
      jest.advanceTimersByTime(50); // fake timers also own requestAnimationFrame
    });
    expect(live()).toHaveTextContent("Penjelasan 2 dari 4");
    jest.useRealTimers();
  });

  it("one marker per explanation, even when two fields share it", () => {
    renderExplorer();
    expect(screen.getAllByRole("button", { name: /Penanda/ })).toHaveLength(4);
  });

  it("without scrollTo (old browsers, jsdom) the active slide still changes", () => {
    renderExplorer();
    fireEvent.click(screen.getByRole("button", { name: "Penjelasan 2 dari 4" }));
    expect(live()).toHaveTextContent("Penjelasan 2 dari 4");
  });
});
