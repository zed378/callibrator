/**
 * P10-02: dictionary access for SERVER code (pages, layouts, `server.ts`). No
 * React, no `next/headers`. The translator itself lives in `translate.ts`,
 * which client components use without pulling these dictionaries in (P10-13).
 */
import { en } from "./messages/en";
import { id, type MessageKey, type Messages } from "./messages/id";
import type { Locale } from "./config";

export { createTranslator, pickMessages, format, type Translate } from "./translate";
export type { MessageKey, Messages };

const DICTIONARIES: Record<Locale, Messages> = { id, en };

export const getMessages = (locale: Locale): Messages => DICTIONARIES[locale];
