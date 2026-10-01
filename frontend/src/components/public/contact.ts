/**
 * P10-03 (ADR-098 §8.8, Q-41): the contact channels come from configuration,
 * never code. A channel whose value is empty is HIDDEN — never a placeholder.
 * `NEXT_PUBLIC_*` values are inlined at build time.
 */
export interface ContactChannels {
  whatsappUrl: string | null;
  emailUrl: string | null;
}

/** Digits only, for wa.me (which takes the number without "+" or spaces). */
const waDigits = (raw: string): string => {
  const d = raw.replace(/[^\d]/g, "");
  return d.startsWith("0") ? `62${d.slice(1)}` : d;
};

export const contactChannels = (
  text: { whatsappText: string; emailSubject: string },
  env: { whatsapp?: string; email?: string } = {
    whatsapp: process.env.NEXT_PUBLIC_CONTACT_WHATSAPP,
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL,
  },
): ContactChannels => {
  const wa = env.whatsapp?.trim() ? waDigits(env.whatsapp) : "";
  const email = env.email?.trim() ?? "";
  return {
    whatsappUrl: wa.length >= 8 ? `https://wa.me/${wa}?text=${encodeURIComponent(text.whatsappText)}` : null,
    emailUrl: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ? `mailto:${email}?subject=${encodeURIComponent(text.emailSubject)}`
      : null,
  };
};
