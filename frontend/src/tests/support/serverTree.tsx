/**
 * Render a Server Component page in Jest.
 *
 * The client renderer refuses an async component ("<X> is an async Client
 * Component"), so the async Server Components in a page's element tree are
 * resolved first, as the Next server does, and the resolved tree is rendered.
 * A <Suspense> boundary is kept with its children resolved: that is the HTML
 * the server streams once the boundary's content is ready (the fallback is the
 * first flush; `findSuspense` reads it).
 *
 * Moved here from app/blog/__tests__/publicContent.test.tsx when the landing
 * became a prerenderable shell with a streamed, locale-aware body (fb55605).
 */
import React from "react";
import { render } from "@testing-library/react";

type Props = Record<string, unknown> & { children?: React.ReactNode };

/** Resolve every async Server Component in a tree (descending through `children`). */
export async function resolveServer(node: React.ReactNode | Promise<React.ReactNode>): Promise<React.ReactNode> {
  if (node instanceof Promise) return resolveServer(await node);
  if (Array.isArray(node)) return Promise.all(node.map(resolveServer));
  if (!React.isValidElement(node)) return node;
  const el = node as React.ReactElement<Props>;
  if (typeof el.type === "function" && el.type.constructor.name === "AsyncFunction") {
    const out = await (el.type as (p: Props) => Promise<React.ReactNode>)(el.props);
    return resolveServer(out);
  }
  if (el.props && "children" in el.props) {
    const children = await resolveServer(el.props.children);
    // Passed as separate arguments, so a resolved list keeps static-children semantics.
    return React.cloneElement(el, undefined, ...(Array.isArray(children) ? children : [children]));
  }
  return el;
}

/** Render a page (or its promise) after resolving its Server Components. */
export const renderServer = async (page: React.ReactNode | Promise<React.ReactNode>) => {
  const tree = await resolveServer(page);
  return render(<>{tree}</>);
};

/** The first <Suspense> element in a tree, without rendering or resolving anything. */
export function findSuspense(node: React.ReactNode): React.ReactElement<React.SuspenseProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSuspense(child as React.ReactNode);
      if (found) return found;
    }
    return null;
  }
  if (!React.isValidElement(node)) return null;
  const el = node as React.ReactElement<Props>;
  if (el.type === React.Suspense) return el as React.ReactElement<React.SuspenseProps>;
  return el.props && "children" in el.props ? findSuspense(el.props.children) : null;
}
