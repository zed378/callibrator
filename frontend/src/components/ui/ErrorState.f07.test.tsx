/**
 * F-07 — a failed request is a failed state with a reason and a reference,
 * never an empty list.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AxiosError, AxiosHeaders } from "axios";
import { ErrorState, errorStateCopy } from "./ErrorState";
import type { ApiErrorDetails } from "@/api/client";
import { axeViolations } from "@/tests/a11y/axe";

const d = (patch: Partial<ApiErrorDetails>): ApiErrorDetails => ({
  status: 500,
  code: null,
  message: "boom",
  requestId: null,
  kind: "http",
  ...patch,
});

const httpError = (status: number, message: string, requestId?: string) => {
  const err = new AxiosError(message, "ERR_BAD_RESPONSE", undefined, undefined, {
    status,
    statusText: "",
    data: { message },
    headers: {},
    config: { headers: new AxiosHeaders() },
  }) as AxiosError & { requestId?: string };
  err.requestId = requestId;
  return err;
};

describe("errorStateCopy (F-07)", () => {
  it("409 shows the backend's state explanation and offers no blind retry", () => {
    expect(
      errorStateCopy(d({ status: 409, message: "The certificate is in draft and must be submitted first" })),
    ).toEqual({
      title: "This action is not possible right now",
      message: "The certificate is in draft and must be submitted first",
      retryable: false,
    });
  });

  it("404 does not say whether the record exists elsewhere (cross-tenant is a 404 too)", () => {
    expect(errorStateCopy(d({ status: 404 })).message).toBe(
      "It does not exist, or it is not available to you.",
    );
  });

  it("403, 408, 429, offline, timeout and the rest", () => {
    expect(errorStateCopy(d({ status: 403, message: "" })).message).toBe("Your role does not permit this.");
    expect(errorStateCopy(d({ status: 403 })).retryable).toBe(false);
    expect(errorStateCopy(d({ status: 408, message: "Request timeout" })).message).toBe("Request timeout");
    expect(errorStateCopy(d({ status: 408, message: "" })).retryable).toBe(true);
    expect(errorStateCopy(d({ status: 429 })).title).toBe("Too many requests");
    expect(errorStateCopy(d({ status: null, kind: "network" })).title).toBe("You appear to be offline");
    expect(errorStateCopy(d({ status: null, kind: "timeout" })).title).toBe("The request timed out");
    expect(errorStateCopy(d({ status: 500 })).message).toBe("boom");
    expect(errorStateCopy(d({ status: 500, message: "" })).message).toBe("The request failed.");
  });
});

describe("ErrorState (F-07)", () => {
  it("shows the reason and the X-Request-Id reference, and retries", async () => {
    const onRetry = jest.fn();
    const { container } = render(
      <ErrorState error={httpError(503, "Database unavailable", "req-42")} onRetry={onRetry} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    expect(screen.getByText("req-42")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(onRetry).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("no Retry for a conflict; a custom title wins", () => {
    render(<ErrorState error={httpError(409, "Already approved")} onRetry={() => {}} title="Cannot approve" />);
    expect(screen.getByText("Cannot approve")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });
});
