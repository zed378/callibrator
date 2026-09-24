// F-03 — browser-only values without setState in an effect.
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { useClientValue, useClockSeconds } from "../useClientValue";
import { useIsClient } from "../useIsClient";

function Year() {
  const y = useClientValue<number | null>(() => 2026, null);
  return <span>{y === null ? "server" : y}</span>;
}
function Client() {
  return <span>{useIsClient() ? "client" : "server"}</span>;
}
function Clock() {
  const s = useClockSeconds();
  return <span data-testid="clock">{s === null ? "none" : String(s)}</span>;
}

describe("useClientValue / useIsClient / useClockSeconds", () => {
  it("the server snapshot is used when rendering on the server", () => {
    expect(renderToString(<Year />)).toContain("server");
    expect(renderToString(<Client />)).toContain("server");
    expect(renderToString(<Clock />)).toContain("none");
  });

  it("the browser value is used on the client", () => {
    render(<><Year /><Client /></>);
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.getByText("client")).toBeInTheDocument();
  });

  it("the clock ticks once a second and unsubscribes on unmount", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-09-24T10:00:00Z"));
    const { unmount } = render(<Clock />);
    const first = Number(screen.getByTestId("clock").textContent);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(Number(screen.getByTestId("clock").textContent)).toBe(first + 1);
    unmount();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
