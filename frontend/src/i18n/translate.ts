/**
 * P10-02 / P10-13: the dictionary-free half of the i18n module — the
 * translator and the namespace picker. Client components reach it through
 * MessagesProvider; it imports NO dictionary, so a client bundle carries only
 * the strings its server page handed it (`pickMessages`), never the ~44 KB of
 * both full dictionaries (ADR-098 Amendment 2). `index.ts` adds the
 * dictionaries for server code.
 */
import type { MessageKey, Messages } from "./messages/id";
import { format } from "./format";

export type { MessageKey, Messages };
export { format };

export type Translate = (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string;

/** A translate function over one dictionary. */
export const createTranslator =
  (messages: Partial<Messages>): Translate =>
  (key, values) =>
    format(messages[key] ?? key, values);

/** The keys under the given namespace prefixes, for a client component's props. */
export const pickMessages = (messages: Messages, prefixes: readonly string[]): Partial<Messages> => {
  const out: Partial<Record<MessageKey, string>> = {};
  for (const key of Object.keys(messages) as MessageKey[]) {
    if (prefixes.some((p) => key.startsWith(p))) out[key] = messages[key];
  }
  return out;
};
