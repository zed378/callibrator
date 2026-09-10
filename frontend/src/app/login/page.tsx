// src/app/login/page.tsx
"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, Lock } from "lucide-react";
import AuthBackground from "@/components/auth/AuthBackground";
import AuthBrandingPanel from "@/components/auth/AuthBrandingPanel";
import { BrandMark } from "@/components/auth/BrandMark";
import { Eyebrow } from "@/components/landing/_shared/Eyebrow";
import { useAuthBrand } from "@/hooks/useAuthBrand";
import { useLoginForm } from "./hooks/useLoginForm";
import PasswordLoginForm from "./components/PasswordLoginForm";
import SsoLoginForm from "./components/SsoLoginForm";
import MfaLoginForm from "./components/MfaLoginForm";

function LoginForm() {
  const {
    username,
    setUsername,
    password,
    setPassword,
    isLoading,
    showPassword,
    setShowPassword,
    error,
    loginMethod,
    setLoginMethod,
    tenantCode,
    setTenantCode,
    ssoProtocol,
    setSsoProtocol,
    ssoLoading,
    ssoError,
    handleSubmit,
    handleSsoSubmit,
    mfaRequired,
    mfaCode,
    setMfaCode,
    mfaLoading,
    handleMfaSubmit,
    cancelMfa,
  } = useLoginForm();

  const { name, logoUrl } = useAuthBrand();

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      <AuthBackground />

      <div className="relative z-10 mx-4 flex w-full max-w-6xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl animate-scale-in">
        {/* Precision hairline: a thin instrument-line accent across the top */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-linear-to-r from-transparent via-primary/50 to-transparent"
          aria-hidden="true"
        />
        <AuthBrandingPanel />

        {/* Right Panel - Login Form */}
        <div className="relative flex w-full items-center justify-center bg-card p-8 sm:p-12 lg:w-7/12">
          <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/5 to-transparent" />

          <div className="relative z-10 w-full max-w-md">
            <Link
              href="/"
              className="group mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span>Return to Home</span>
            </Link>

            <div className="mb-8 flex flex-col items-center text-center lg:hidden animate-fade-in-down">
              <BrandMark logoUrl={logoUrl} name={name} size="lg" />
              <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground">
                {name}
              </h1>
            </div>

            <div className="mb-8 animate-fade-in-up">
              <Eyebrow>Sign in</Eyebrow>
              <h2 className="mb-2 mt-4 font-display text-3xl font-bold tracking-tight text-foreground">
                Welcome back
              </h2>
              <p className="text-muted-foreground">
                Sign in to your account to continue
              </p>
            </div>

            {(error || ssoError) && (
              <div className="mb-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm flex items-center gap-3 animate-fade-in">
                <Lock className="w-5 h-5 flex-shrink-0" />
                {error || ssoError}
              </div>
            )}

            {mfaRequired ? (
              <MfaLoginForm
                code={mfaCode}
                setCode={setMfaCode}
                onSubmit={handleMfaSubmit}
                onBack={cancelMfa}
                isLoading={mfaLoading}
              />
            ) : (
              <>
                <div className="relative flex bg-muted p-1 rounded-xl mb-6 shadow-inner">
                  {(["password", "sso"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setLoginMethod(m)}
                      className={`relative z-10 flex-1 py-2 text-sm font-semibold rounded-lg transition-colors duration-200 ${
                        loginMethod === m
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {loginMethod === m && (
                        <motion.span
                          layoutId="login-tab-indicator"
                          className="absolute inset-0 -z-10 rounded-lg bg-card shadow-md"
                          transition={{ type: "spring", stiffness: 400, damping: 32 }}
                        />
                      )}
                      {m === "password" ? "Password Login" : "Enterprise SSO"}
                    </button>
                  ))}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={loginMethod}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.22, ease: "easeOut" }}
                  >
                    {loginMethod === "sso" ? (
                      <SsoLoginForm
                        tenantCode={tenantCode}
                        setTenantCode={setTenantCode}
                        ssoProtocol={ssoProtocol}
                        setSsoProtocol={setSsoProtocol}
                        onSubmit={handleSsoSubmit}
                        ssoLoading={ssoLoading}
                      />
                    ) : (
                      <PasswordLoginForm
                        username={username}
                        setUsername={setUsername}
                        password={password}
                        setPassword={setPassword}
                        onSubmit={handleSubmit}
                        isLoading={isLoading}
                        showPassword={showPassword}
                        setShowPassword={setShowPassword}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>
              </>
            )}

            <div className="mt-8 text-center animate-fade-in-up delay-300">
              <span className="text-muted-foreground text-sm">
                New to the platform?{" "}
              </span>
              <Link
                href="/register"
                className="font-semibold text-primary hover:text-primary transition-colors"
              >
                Create a tenant workspace
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
