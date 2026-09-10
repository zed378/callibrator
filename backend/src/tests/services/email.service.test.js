const nodemailer = require("nodemailer");
const mustache = require("mustache");
const fs = require("fs");
const path = require("path");

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: "123" }),
  }),
}));
jest.mock("mustache", () => ({
  render: jest.fn((template, variables) => {
    return `Rendered: ${template} with ${JSON.stringify(variables)}`;
  }),
}));
jest.mock("fs", () => ({
  readFileSync: jest.fn().mockImplementation((filepath) => {
    if (filepath.includes("template.html")) {return "Mock Activation Template: {{firstName}} {{link}}";}
    if (filepath.includes("otp.html")) {return "Mock OTP Template: {{firstName}} {{otp}}";}
    return "Default Template";
  }),
}));

// Mock process.env before requiring the service
process.env.MAIL_HOST = "smtp.test.com";
process.env.MAIL_PORT = "587";
process.env.MAIL_USER = "test@example.com";
process.env.MAIL_PASSWORD = "password";
process.env.MAIL_FROM = "noreply@example.com";

const { sendEmail, sendActivationEmail, sendOtpEmail, sendNotificationEmail } = require("../../services/email.service");

describe("email.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("sendEmail", () => {
    it("should send an email with correct parameters", async () => {
      const mockSendMail = require("nodemailer").createTransport().sendMail;
      const emailData = {
        to: "user@test.com",
        subject: "Test Subject",
        html: "<p>Test HTML</p>",
      };

      const result = await sendEmail(emailData);

      expect(mockSendMail).toHaveBeenCalledWith({
        from: "noreply@example.com",
        to: "user@test.com",
        subject: "Test Subject",
        html: "<p>Test HTML</p>",
      });
      expect(result).toEqual({ messageId: "123" });
    });
  });

  describe("sendActivationEmail", () => {
    it("should render template and send activation email", async () => {
      const mockSendMail = require("nodemailer").createTransport().sendMail;
      const emailData = {
        email: "newuser@test.com",
        firstName: "John",
        lastName: "Doe",
        activationLink: "http://activate.test/123",
      };

      const result = await sendActivationEmail(emailData);

      expect(require("mustache").render).toHaveBeenCalledWith(
        "Mock Activation Template: {{firstName}} {{link}}",
        {
          firstName: "John",
          lastName: "Doe",
          link: "http://activate.test/123",
        },
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "newuser@test.com",
          subject: "Account Activation",
          html: expect.stringContaining("Rendered: Mock Activation Template"),
        }),
      );
      expect(result).toEqual({ messageId: "123" });
    });
  });

  describe("sendOtpEmail", () => {
    it("should render template and send OTP email", async () => {
      const mockSendMail = require("nodemailer").createTransport().sendMail;
      const emailData = {
        email: "forgot@test.com",
        firstName: "Jane",
        lastName: "Smith",
        otp: "123456",
      };

      const result = await sendOtpEmail(emailData);

      expect(require("mustache").render).toHaveBeenCalledWith(
        "Mock OTP Template: {{firstName}} {{otp}}",
        {
          firstName: "Jane",
          lastName: "Smith",
          otp: "123456",
        },
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "forgot@test.com",
          subject: "Password Reset OTP",
          html: expect.stringContaining("Rendered: Mock OTP Template"),
        }),
      );
      expect(result).toEqual({ messageId: "123" });
    });
  });

  describe("sendNotificationEmail", () => {
    it("should send notification email with all fields and CTA url", async () => {
      const mockSendMail = require("nodemailer").createTransport().sendMail;
      const result = await sendNotificationEmail({
        email: "recipient@test.com",
        firstName: "Alice",
        title: "Test Title & Special chars",
        message: "Hello <World>",
        actionUrl: "https://view.details.com/123",
      });

      expect(mockSendMail).toHaveBeenCalledWith({
        from: "noreply@example.com",
        to: "recipient@test.com",
        subject: "Test Title & Special chars",
        html: expect.stringContaining("Test Title &amp; Special chars"),
      });
      expect(mockSendMail.mock.calls[0][0].html).toContain("Hi Alice");
      expect(mockSendMail.mock.calls[0][0].html).toContain("Hello &lt;World&gt;");
      expect(mockSendMail.mock.calls[0][0].html).toContain('href="https://view.details.com/123"');
      expect(result).toEqual({ messageId: "123" });
    });

    it("should fall back to default name when firstName is missing and omit CTA when actionUrl is invalid", async () => {
      const mockSendMail = require("nodemailer").createTransport().sendMail;
      await sendNotificationEmail({
        email: "recipient@test.com",
        title: "Title",
        message: "Message",
        actionUrl: "invalid-url",
      });

      expect(mockSendMail.mock.calls[0][0].html).toContain("Hi there");
      expect(mockSendMail.mock.calls[0][0].html).not.toContain("View details");
    });
  });
});
