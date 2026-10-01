/**
 * Q-51 (ADR-100 Amendment 2) — who wrote a stock or calibration row.
 *
 * A row names EITHER a user (its `performer` / `adjuster` / `requester`) OR
 * the API key that wrote it (`apiKey`: id, name and display prefix only; the
 * backend never sends the key's hash). Before, a key-written row showed "-".
 */

/** The user shape the list endpoints include. */
export interface ActorUser {
  firstName?: string | null;
  lastName?: string | null;
}

/** The key shape the list endpoints include. */
export interface ActorApiKey {
  id: string;
  name: string;
  keyPrefix?: string | null;
}

/**
 * @returns "First Last" for a user, "API key: <name>" for a key, or null
 */
export function actorLabel(
  user: ActorUser | null | undefined,
  apiKey: ActorApiKey | null | undefined,
): string | null {
  if (user) {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    return name === "" ? null : name;
  }
  if (apiKey) {
    return `API key: ${apiKey.name}`;
  }
  return null;
}
