// P10-03 (doc 20 §6.5): the landing's certificate-number field is a plain
// `<form method="get" action="/verify">`; this page turns `?number=` into the
// verification page's own URL, so the lookup works without JavaScript.
import { redirect } from "next/navigation";

export default async function VerifyLookup({
  searchParams,
}: {
  searchParams: Promise<{ number?: string | string[] }>;
}) {
  const raw = (await searchParams).number;
  const number = (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
  redirect(number ? `/verify/${encodeURIComponent(number)}` : "/#verifikasi");
}
