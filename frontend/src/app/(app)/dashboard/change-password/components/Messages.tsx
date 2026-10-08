import React from "react";
import { Alert } from "@/components/ui";

export const SuccessMessage: React.FC<{ message: string }> = ({ message }) => (
  <Alert variant="success">{message}</Alert>
);

export const FormError: React.FC<{ message: string }> = ({ message }) => (
  <Alert variant="error">{message}</Alert>
);
