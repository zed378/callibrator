import { useState } from "react";
import { useToastStore } from "@/stores/toastStore";
import { authService } from "@/api/services/auth.service";

export function useRegisterForm() {
  const { addToast } = useToastStore();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(false);
    setError(null);

    if (firstName.trim().length < 2) {
      setError("First name must be at least 2 characters");
      return;
    }
    if (username.trim().length < 3 || !/^[a-zA-Z0-9]+$/.test(username)) {
      setError("Username must be at least 3 alphanumeric characters");
      return;
    }
    if (password.length < 8 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/.test(password)) {
      setError("Password must be at least 8 characters and contain uppercase, lowercase, and a number");
      return;
    }

    setIsLoading(true);

    try {
      await authService.register({
        firstName,
        lastName: lastName.trim() || "",
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        password,
      });

      setIsSuccess(true);
      addToast({
        type: "success",
        title: "Registration successful!",
        description: "Please check your email to activate your account.",
        duration: 7000,
      });
    } catch (err) {
      console.error("[Register] Registration failed:", err);
      const regErr = err as { response?: { data?: { message?: string } }; message?: string };
      const errMsg = regErr.response?.data?.message || regErr.message || "Registration failed";
      setError(errMsg);
      addToast({
        type: "error",
        title: "Registration failed",
        description: errMsg,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
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
  };
}

export default useRegisterForm;
