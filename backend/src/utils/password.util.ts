// P9-09 (ADR-087): converted from password.util.js with no behaviour change.
// Named imports: each call reads `bcryptjs.hash`/`compare` at call time, as
// `bcrypt.hash(...)` did, so a jest.mock("bcryptjs") factory still applies.
import { compare, hash } from "bcryptjs";

export const hashPassword = async (password: string): Promise<string> => {
  return hash(password, 12);
};

export const comparePassword = async (plain: string, hashed: string): Promise<boolean> => {
  return compare(plain, hashed);
};
