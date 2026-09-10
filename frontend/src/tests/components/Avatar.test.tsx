import React from "react";
import { render, screen } from "@testing-library/react";
import { Avatar } from "@/components/ui";

/**
 * Regression: the backend returns ABSOLUTE upload URLs (from its HOST_URL).
 * next/image rejects those with `"url" parameter is not allowed`, so Avatar
 * rewrites /uploads/* to a same-origin path (next.config proxies it).
 */
describe("Avatar", () => {
  const srcOf = (container: HTMLElement) =>
    decodeURIComponent(
      container.querySelector("img")?.getAttribute("src") || "",
    );

  it("strips the backend origin from absolute /uploads URLs", () => {
    const { container } = render(
      <Avatar
        src="http://localhost:5000/uploads/profile/pic.jpg"
        alt="Ada"
        fallback="Ada Lovelace"
      />,
    );
    const src = srcOf(container);
    expect(src).toContain("/uploads/profile/pic.jpg");
    expect(src).not.toContain("localhost:5000");
  });

  it("leaves an already-relative upload path alone", () => {
    const { container } = render(
      <Avatar src="/uploads/profile/pic.jpg" alt="Ada" />,
    );
    expect(srcOf(container)).toContain("/uploads/profile/pic.jpg");
  });

  it("does not rewrite non-upload URLs", () => {
    const { container } = render(
      <Avatar src="https://cdn.example.com/img.png" alt="Ada" />,
    );
    expect(srcOf(container)).toContain("https://cdn.example.com/img.png");
  });

  it("renders initials when there is no src", () => {
    render(<Avatar alt="Ada Lovelace" fallback="Ada Lovelace" />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });
});
