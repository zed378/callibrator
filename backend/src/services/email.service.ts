/**
 * Outbound email: the SMTP transporter and the activation, OTP and
 * notification messages.
 *
 * P9-18 (ADR-087, Stage C leaves): converted from email.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned
 * (the same keys, in the same order). nodemailer, mustache and fs are the
 * module objects themselves (default imports of CommonJS modules), loaded in
 * the same order as before, so the tests' `jest.mock` factories still apply.
 * The templates are still read and the transporter still built at load.
 * Environment reads go through src/config/env (P9-06); `||` stays wherever
 * the `.js` had it, because an empty variable has always meant "unset".
 */
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import mustache from "mustache";

import fs from "fs";

import appPath from "../utils/appPath.util";
import { env, envOr } from "../config/env";

interface BrandContext {
  appUrl: string;
  appName: string;
  logoUrl: string;
  supportEmail: string;
}

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

interface ActivationEmailInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  activationLink: string;
}

interface OtpEmailInput {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  otp: string;
}

interface NotificationEmailInput {
  email: string;
  firstName?: unknown;
  title: string;
  message?: unknown;
  actionUrl?: string | null;
}

type SentMessageInfo = SMTPTransport.SentMessageInfo;

// ==========================================
// EMAIL TEMPLATES
// ==========================================

// Resolve via appPath (execPath-relative when packaged) so the templates are
// read from files shipped alongside the binary — a compiled single-file binary
// cannot fs.read its own __dirname-embedded assets under bun.
const activationTemplate = fs.readFileSync(
  appPath("src", "templates", "template.html"),

  "utf8",
);

const otpTemplate = fs.readFileSync(
  appPath("src", "templates", "otp.html"),

  "utf8",
);

// ==========================================
// BRANDING
// ==========================================

// Every template used to hard-code https://fullfind.co/logo.png — the logo of
// an unrelated company, inherited from the boilerplate this project started
// from. That is three separate problems: every outbound email carried someone
// else's branding, the images broke the moment that domain changed anything,
// and each recipient's mail client fetched an asset from a third party, which
// leaks open events to them.
//
// These now resolve against this deployment. The logo is served from the
// public web origin rather than the backend's own /public mount, because that
// is the origin nginx exposes and an emailed URL has to be reachable from
// outside the network.
const brandContext = (): BrandContext => {
  const appUrl = envOr("HOST_URL", "").replace(/\/+$/, "");
  return {
    appUrl,
    // The footer carried the boilerplate company's NAME as readable text, not
    // just its URLs — a case-sensitive grep for the domain missed it entirely.
    appName: envOr("APP_NAME", "Device Calibrator"),
    logoUrl: `${appUrl}/brand/logo-email.png`,
    supportEmail: envOr("MAIL_FROM", ""),
  };
};

// ==========================================
// TRANSPORTER
// ==========================================

// As built, nodemailer receives the raw environment strings: `port` is the
// MAIL_PORT text (nodemailer converts it), and an unset variable is passed as
// `undefined`. The typings want a number and no explicit `undefined`, so the
// options object is built as it always was and then viewed as the SMTP options.
const transportOptions = {
  host: env("MAIL_HOST"),
  port: env("MAIL_PORT"),
  auth: {
    user: env("MAIL_USER"),
    pass: env("MAIL_PASSWORD"),
  },
};
const transporter = nodemailer.createTransport(transportOptions as unknown as SMTPTransport.Options);

// ==========================================
// SEND EMAIL
// ==========================================

const sendEmail = async ({ to, subject, html }: SendEmailInput): Promise<SentMessageInfo> => {
  return transporter.sendMail({
    from: env("MAIL_FROM"),
    to,
    subject,
    html,
  });
};

// ==========================================
// SEND ACTIVATION EMAIL
// ==========================================

const sendActivationEmail = async ({
  email,
  firstName,
  lastName,
  activationLink,
}: ActivationEmailInput): Promise<SentMessageInfo> => {
  const html = mustache.render(activationTemplate, {
    ...brandContext(),
    firstName,
    lastName,
    link: activationLink,
  });

  return sendEmail({
    to: email,
    subject: "Account Activation",
    html,
  });
};

// ==========================================
// SEND OTP EMAIL
// ==========================================

const sendOtpEmail = async ({ email, firstName, lastName, otp }: OtpEmailInput): Promise<SentMessageInfo> => {
  const html = mustache.render(otpTemplate, {
    ...brandContext(),
    firstName,
    lastName,
    otp,
  });

  return sendEmail({
    to: email,
    subject: "Password Reset OTP",
    html,
  });
};

// ==========================================
// SEND NOTIFICATION EMAIL
// ==========================================

const escapeHtml = (v: unknown): string =>
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: String() of whatever the caller passed
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const sendNotificationEmail = async ({
  email,
  firstName,
  title,
  message,
  actionUrl,
}: NotificationEmailInput): Promise<SentMessageInfo> => {
  const name = escapeHtml(firstName) || "there";
  const cta =
    actionUrl && /^https?:\/\//i.test(actionUrl)
      ? `<p><a href="${escapeHtml(actionUrl)}" style="color:#001250;font-weight:700">View details</a></p>`
      : "";
  // A-172 — the footer names this deployment's brand (APP_NAME), as the
  // activation and OTP templates do. It hard-coded "Calibration Management
  // System", a name no deployment is configured with.
  // Brand palette as in src/templates (navy #001250, teal #00DAB4, slate text).
  const brand = brandContext();
  const html = `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:auto;color:#0f172a;border-top:4px solid #00dab4;padding-top:20px">
    <img src="${escapeHtml(brand.logoUrl)}" width="192" alt="${escapeHtml(brand.appName)}" style="display:block;border:0;width:192px;height:auto;margin:0 0 20px"/>
    <h2 style="margin:0 0 12px;color:#001250">${escapeHtml(title)}</h2>
    <p>Hi ${name},</p>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
    ${cta}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
    <p style="color:#6b7280;font-size:12px">${escapeHtml(brandContext().appName)}</p>
  </div>`;

  return sendEmail({ to: email, subject: title, html });
};

export = {
  sendEmail,
  sendActivationEmail,
  sendOtpEmail,
  sendNotificationEmail,
};
