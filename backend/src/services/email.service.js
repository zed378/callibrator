const nodemailer = require("nodemailer");
const mustache = require("mustache");

const fs = require("fs");

const appPath = require("../utils/appPath.util");

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
// TRANSPORTER
// ==========================================

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASSWORD,
  },
});

// ==========================================
// SEND EMAIL
// ==========================================

const sendEmail = async ({ to, subject, html }) => {
  return transporter.sendMail({
    from: process.env.MAIL_FROM,
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
}) => {
  const html = mustache.render(activationTemplate, {
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

const sendOtpEmail = async ({ email, firstName, lastName, otp }) => {
  const html = mustache.render(otpTemplate, {
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

const escapeHtml = (v) =>
  String(v === null || v === undefined ? "" : v)
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
}) => {
  const name = escapeHtml(firstName) || "there";
  const cta =
    actionUrl && /^https?:\/\//i.test(actionUrl)
      ? `<p><a href="${escapeHtml(actionUrl)}" style="color:#4f46e5">View details</a></p>`
      : "";
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
    <h2 style="margin:0 0 12px">${escapeHtml(title)}</h2>
    <p>Hi ${name},</p>
    <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
    ${cta}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
    <p style="color:#6b7280;font-size:12px">Calibration Management System</p>
  </div>`;

  return sendEmail({ to: email, subject: title, html });
};

module.exports = {
  sendEmail,
  sendActivationEmail,
  sendOtpEmail,
  sendNotificationEmail,
};
