/**
 * F-07 — route-level error boundaries exist and render a recoverable state.
 * Fail-before: no app/error.tsx or app/dashboard/error.tsx existed. ADR-131
 * (P10-18): one boundary per root layout, app/(public) and app/(app).
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import PublicError from "@/app/(public)/error";
import AppError from "@/app/(app)/error";
import DashboardError from "@/app/(app)/dashboard/error";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => (console.error as jest.Mock).mockRestore());

describe("route error boundaries (F-07)", () => {
  it.each([
    ["app/(public)/error.tsx", PublicError],
    ["app/(app)/error.tsx", AppError],
  ])("%s: a thrown render error shows a retry and the digest reference", (_file, Boundary) => {
    const reset = jest.fn();
    const err = Object.assign(new Error("secret stack detail"), { digest: "abc123" });
    render(<Boundary error={err} reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent("This page failed to load");
    expect(screen.queryByText(/secret stack detail/)).toBeNull();
    expect(screen.getByText("abc123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /home page/ })).toHaveAttribute("href", "/");
    // P10-18: the boundary replaces the page, so it is the page's one landmark and heading.
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("ADR-131: the public boundary draws on the public surface, the app's on the dashboard tokens", () => {
    const { container, unmount } = render(<PublicError error={new Error("x")} reset={() => {}} />);
    expect(container.querySelector('[data-surface="public"] main')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/text-destructive|text-foreground|bg-primary/);
    unmount();
    const app = render(<AppError error={new Error("x")} reset={() => {}} />);
    expect(app.container.querySelector("[data-surface]")).toBeNull();
    expect(app.container.innerHTML).toMatch(/text-destructive/);
  });

  it("app/dashboard/error.tsx leads back to the dashboard", () => {
    render(<DashboardError error={new Error("x")} reset={() => {}} />);
    expect(screen.getByRole("link", { name: /Back to the dashboard/ })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("a real boundary catches a throwing child", () => {
    class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
      state = { error: null as Error | null };
      static getDerivedStateFromError(error: Error) {
        return { error };
      }
      render() {
        return this.state.error ? (
          <DashboardError error={this.state.error} reset={() => this.setState({ error: null })} />
        ) : (
          this.props.children
        );
      }
    }
    const Thrower = () => {
      throw new Error("render failed");
    };
    render(
      <Boundary>
        <Thrower />
      </Boundary>,
    );
    expect(screen.getByText("This page failed to load")).toBeInTheDocument();
  });
});
