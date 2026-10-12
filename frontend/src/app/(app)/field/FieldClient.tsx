"use client";
/** P22-10c2 — the field app's client island, wired to the browser. */
import React from "react";
import { FieldApp } from "@/field/ui/FieldApp";
import { browserStoreDeps } from "@/field/ui/browserDeps";

export function FieldClient() {
  return <FieldApp deps={browserStoreDeps} />;
}
