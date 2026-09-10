// src/app/register/page.tsx
"use client";

import React, { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft, AlertCircle } from "lucide-react";
import AuthBackground from "@/components/auth/AuthBackground";
import Spinner from "@/components/auth/Spinner";
import AuthBrandingPanel from "@/components/auth/AuthBrandingPanel";
import { BrandMark } from "@/components/auth/BrandMark";
import { Eyebrow } from "@/components/landing/_shared/Eyebrow";
import { useAuthBrand } from "@/hooks/useAuthBrand";
import { useRegisterForm } from "./hooks/useRegisterForm";
import RegisterSuccessPanel from "./components/RegisterSuccessPanel";
import RegisterInputs from "./components/RegisterInputs";

function RegisterForm() {
  const {
    firstName,
    setFirstName,
    lastName,
    setLastName,
    username,
    setUsername,
    email,
    setEmail,
    password,
    setPassword,
    isLoading,
    showPassword,
    setShowPassword,
    error,
    isSuccess,
    handleSubmit,
  } = useRegisterForm();

  const { name, logoUrl } = useAuthBrand();

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
        <AuthBackground />
        <RegisterSuccessPanel email={email} />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
      <AuthBackground />

      <div className="relative z-10 mx-4 flex w-full max-w-6xl overflow-hidden rounded-3xl border border-border bg-card shadow-2xl animate-scale-in">
        {/* Precision hairline: a thin instrument-line accent across the top */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-linear-to-r from-transparent via-primary/50 to-transparent"
          aria-hidden="true"
        />
        <AuthBrandingPanel tagline="Create your workspace and start managing medical device calibration — compliant from day one." />

        {/* Right Panel - Register Form */}
        <div className="relative flex w-full items-center justify-center bg-card p-8 sm:p-12 lg:w-7/12">
          <div className="pointer-events-none absolute inset-0 bg-linear-to-br from-primary/5 to-transparent" />

          <div className="relative z-10 w-full max-w-md">
            <Link
              href="/"
              className="group mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
              <span>Return to Home</span>
            </Link>

            <div className="mb-6 flex flex-col items-center text-center lg:hidden animate-fade-in-down">
              <BrandMark logoUrl={logoUrl} name={name} size="lg" />
              <h1 className="mt-4 font-display text-2xl font-bold tracking-tight text-foreground">
                {name}
              </h1>
            </div>

            <div className="mb-6 animate-fade-in-up">
              <Eyebrow>Get started</Eyebrow>
              <h2 className="mb-2 mt-4 font-display text-3xl font-bold tracking-tight text-foreground">
                Create your account
              </h2>
              <p className="text-muted-foreground">
                Register to start managing medical calibrations
              </p>
            </div>

            {error && (
              <div className="mb-5 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-destructive text-sm flex items-center gap-3 animate-fade-in">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form
              onSubmit={handleSubmit}
              className="space-y-4 animate-fade-in-up delay-100"
            >
              <RegisterInputs
                firstName={firstName}
                setFirstName={setFirstName}
                lastName={lastName}
                setLastName={setLastName}
                username={username}
                setUsername={setUsername}
                email={email}
                setEmail={setEmail}
                password={password}
                setPassword={setPassword}
                showPassword={showPassword}
                setShowPassword={setShowPassword}
              />

              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-2 py-3.5 px-4 bg-linear-to-r from-primary to-accent hover:from-primary hover:to-accent text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <Spinner />
                    <span>Creating Account...</span>
                  </>
                ) : (
                  <span>Create Account</span>
                )}
              </button>
            </form>

            <div className="mt-6 text-center animate-fade-in-up delay-300">
              <span className="text-muted-foreground text-sm">
                Already have an account?{" "}
              </span>
              <Link
                href="/login"
                className="font-semibold text-primary hover:text-primary transition-colors"
              >
                Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}
