/** @jest-environment jsdom */
/**
 * A-141 — the MFA sign-in step accepts a one-time recovery code.
 *
 * Fail-before: the form had one numeric input capped at six digits, so a
 * recovery code could not even be typed.
 */
import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import MfaLoginForm, { formatRecoveryCodeInput } from "./MfaLoginForm";

jest.mock("@/components/auth/Spinner", () => function Spinner() {
  return <span data-testid="spinner" />;
});

function Harness({ onSubmit }: { onSubmit: (code: string, recovery: boolean) => void }) {
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  return (
    <MfaLoginForm
      code={code}
      setCode={setCode}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code, recovery);
      }}
      onBack={() => undefined}
      isLoading={false}
      useRecoveryCode={recovery}
      setUseRecoveryCode={(v) => {
        setRecovery(v);
        setCode("");
      }}
    />
  );
}

describe("A-141: MfaLoginForm recovery code", () => {
  it("formats input as XXXX-XXXX-XXXX-XXXX, base32 only, upper case", () => {
    expect(formatRecoveryCodeInput("abcd efgh-ijkl mnop")).toBe("ABCD-EFGH-IJKL-MNOP");
    expect(formatRecoveryCodeInput("ab1c8d")).toBe("ABCD"); // 1 and 8 are not base32
    expect(formatRecoveryCodeInput("ABCDEFGHIJKLMNOPQRST")).toBe("ABCD-EFGH-IJKL-MNOP");
    expect(formatRecoveryCodeInput("")).toBe("");
  });

  it("switches to a recovery code, enables submit only when complete, and submits it as one", () => {
    const onSubmit = jest.fn();
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText(/Use a recovery code/i));
    const input = screen.getByLabelText("Recovery code");
    const submit = screen.getByRole("button", { name: /Verify & Sign In/i });

    fireEvent.change(input, { target: { value: "abcd-efgh" } });
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "abcdefghijklmnop" } });
    expect((input as HTMLInputElement).value).toBe("ABCD-EFGH-IJKL-MNOP");
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith("ABCD-EFGH-IJKL-MNOP", true);
  });

  it("switching back restores the 6-digit authenticator input", () => {
    render(<Harness onSubmit={jest.fn()} />);

    fireEvent.click(screen.getByText(/Use a recovery code/i));
    fireEvent.click(screen.getByText(/Use a code from my authenticator app/i));

    const input = screen.getByLabelText("Authentication code");
    fireEvent.change(input, { target: { value: "12a3456789" } });
    expect((input as HTMLInputElement).value).toBe("123456");
  });

  it("without the toggle handler (older callers) no recovery link is shown", () => {
    render(
      <MfaLoginForm
        code=""
        setCode={() => undefined}
        onSubmit={() => undefined}
        onBack={() => undefined}
        isLoading={false}
      />,
    );
    expect(screen.queryByText(/recovery code/i)).toBeNull();
  });
});
