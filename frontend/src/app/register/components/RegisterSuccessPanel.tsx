import React from "react";
import Link from "next/link";

export function RegisterSuccessPanel({ email }: { email: string }) {
  return (
    <div className="relative z-10 mx-4 w-full max-w-xl rounded-3xl border border-border bg-card p-8 text-center shadow-2xl animate-scale-in sm:p-12">
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
        <svg
          viewBox="0 0 52 52"
          className="h-11 w-11 text-success"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle
            className="animate-draw-check"
            pathLength={1}
            cx="26"
            cy="26"
            r="22"
          />
          <path
            className="animate-draw-check [animation-delay:250ms]"
            pathLength={1}
            d="M16 27 l7 7 l14 -16"
          />
        </svg>
      </div>
      <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground">
        Check your email
      </h2>
      <p className="mb-8 text-base leading-relaxed text-muted-foreground">
        We have sent an activation link to{" "}
        <strong className="text-foreground">{email}</strong>. Please check your
        inbox and click the link to verify your account.
      </p>
      <Link
        href="/login"
        className="inline-flex w-full items-center justify-center py-3.5 px-4 bg-linear-to-r from-primary to-accent hover:from-primary hover:to-accent text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300 transform hover:-translate-y-0.5"
      >
        Proceed to Sign In
      </Link>
    </div>
  );
}

export default RegisterSuccessPanel;
