/**
 * F-07 — route-level error boundaries exist and render a recoverable state.
 * Fail-before: no app/error.tsx or app/dashboard/error.tsx existed.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import AppError from "@/app/error";
import DashboardError from "@/app/dashboard/error";

beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => (console.error as jest.Mock).mockRestore());

describe("route error boundaries (F-07)", () => {
  it("app/error.tsx: a thrown render error shows a retry and the digest reference", () => {
    const reset = jest.fn();
    const err = Object.assign(new Error("secret stack detail"), { digest: "abc123" });
    render(<AppError error={err} reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent("This page failed to load");
    expect(screen.queryByText(/secret stack detail/)).toBeNull();
    expect(screen.getByText("abc123")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(reset).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /home page/ })).toHaveAttribute("href", "/");
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
