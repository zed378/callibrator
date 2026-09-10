import React from "react";
import { User, Mail, Lock, Eye, EyeOff } from "lucide-react";

interface RegisterInputsProps {
  firstName: string;
  setFirstName: (val: string) => void;
  lastName: string;
  setLastName: (val: string) => void;
  username: string;
  setUsername: (val: string) => void;
  email: string;
  setEmail: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  showPassword: boolean;
  setShowPassword: (val: boolean) => void;
}

export function RegisterInputs({
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
  showPassword,
  setShowPassword,
}: RegisterInputsProps) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label
            htmlFor="firstName"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            First Name <span className="text-primary font-bold">*</span>
          </label>
          <input
            id="firstName"
            type="text"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="w-full px-4 py-3 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="John"
          />
        </div>

        <div>
          <label
            htmlFor="lastName"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Last Name
          </label>
          <input
            id="lastName"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="w-full px-4 py-3 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="Doe"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="username"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Username <span className="text-primary font-bold">*</span>
        </label>
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <User className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            id="username"
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="johndoe"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Email Address <span className="text-primary font-bold">*</span>
        </label>
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Mail className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="you@hospital.com"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Password <span className="text-primary font-bold">*</span>
        </label>
        <div className="relative group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Lock className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
          </div>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full pl-11 pr-12 py-3.5 bg-muted ring-1 ring-border ring-inset rounded-xl text-foreground focus:ring-2 focus:ring-ring/50 transition-all duration-200 placeholder:text-muted-foreground"
            placeholder="••••••••"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute inset-y-0 right-0 pr-4 flex items-center text-muted-foreground hover:text-muted-foreground transition-colors"
          >
            {showPassword ? (
              <EyeOff className="h-5 w-5" />
            ) : (
              <Eye className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    </>
  );
};

export default RegisterInputs;
