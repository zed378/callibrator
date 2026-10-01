/**
 * P10-02: the request's locale, read on the server from the `locale` cookie
 * (default `id`). Server components call this; nothing on the client reads the
 * cookie (it is HttpOnly).
 */
import { cookies } from "next/headers";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./config";
import { createTranslator, getMessages, type Messages, type Translate } from "./index";

export const getLocale = async (): Promise<Locale> => resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);

export const getServerI18n = async (): Promise<{ locale: Locale; messages: Messages; t: Translate }> => {
  const locale = await getLocale();
  const messages = getMessages(locale);
  return { locale, messages, t: createTranslator(messages) };
};
