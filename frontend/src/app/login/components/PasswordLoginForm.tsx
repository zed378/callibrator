// src/app/login/components/PasswordLoginForm.tsx
import React from "react";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import Spinner from "@/components/auth/Spinner";

interface PasswordLoginFormProps {
  username: string;
  setUsername: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
  showPassword: boolean;
  setShowPassword: (val: boolean) => void;
}

export function PasswordLoginForm({
  username,
  setUsername,
  password,
  setPassword,
  onSubmit,
  isLoading,
  showPassword,
  setShowPassword,
}: PasswordLoginFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 animate-fade-in-up delay-200"
    >
      <div>
        <label
          htmlFor="username"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Email or Username
        </label>
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Mail className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="w-full pl-11 pr-4 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="you@hospital.com"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-foreground mb-2"
        >
          Password
        </label>
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="w-full pl-11 pr-12 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-muted-foreground hover:text-foreground transition-colors"
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" />
            ) : (
              <Eye className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer group text-muted-foreground hover:text-foreground">
          <input
            type="checkbox"
            className="w-4 h-4 rounded ring-1 ring-border ring-inset bg-card text-primary focus:ring-ring/50 focus:ring-offset-0 cursor-pointer"
          />
          <span className="text-sm">Remember me</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full py-3.5 px-4 bg-linear-to-r from-primary to-accent hover:from-primary hover:to-accent text-primary-foreground font-semibold rounded-xl shadow-lg shadow-primary/25 hover:shadow-primary/40 transition-all duration-300 transform hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center gap-2"
      >
        {isLoading ? (
          <>
            <Spinner />
            <span>Signing In...</span>
          </>
        ) : (
          <span>Sign In</span>
        )}
      </button>
    </form>
  );
};

export default PasswordLoginForm;
