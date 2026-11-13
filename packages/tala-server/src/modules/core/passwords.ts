/**
 * Password hashing (Argon2id) and the password policy (PRD AUTH-2).
 * OWNER: workstream A.
 *
 * Policy: at least 10 characters (the contract's `Password` schema), not a commonly used or breached
 * password (bundled list, no outside lookup), not the account's own email or name, not one repeated
 * character or a plain run. There are deliberately no composition rules.
 */
import { randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { COMMON_PASSWORDS_TEXT } from './common-passwords.generated';

/** Algorithm.Argon2id in @node-rs/argon2 (a const enum, which isolatedModules cannot import). */
const ARGON2ID = 2;

export interface Argon2Cost {
  /** KiB */
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** OWASP's baseline for Argon2id: 19 MiB, 2 passes, 1 lane. */
export const DEFAULT_ARGON2_COST: Argon2Cost = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** For tests only: the smallest cost the library accepts, so a suite can create many users quickly. */
export const TEST_ARGON2_COST: Argon2Cost = { memoryCost: 8, timeCost: 1, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 10;

export type PasswordProblem = 'too_short' | 'too_common' | 'too_simple' | 'matches_account';

export const PASSWORD_PROBLEM_MESSAGE: Record<PasswordProblem, string> = {
  too_short: 'Please use a password with at least 10 characters.',
  too_common: 'Many people use that password, so it is easy to guess. Please choose a different one.',
  too_simple: 'That password is too easy to guess. Please choose a different one.',
  matches_account: 'Please choose a password that is different from your email and your name.',
};

let commonSet: Set<string> | null = null;

export function isCommonPassword(password: string): boolean {
  commonSet ??= new Set(COMMON_PASSWORDS_TEXT.split('\n'));
  return commonSet.has(password.normalize('NFKC').toLowerCase());
}

function isTrivial(password: string): boolean {
  const p = password.toLowerCase();
  if (new Set(p).size <= 2) return true; // "aaaaaaaaaa", "ababababab"
  // A single run up or down: "abcdefghij", "0987654321"
  let up = true;
  let down = true;
  for (let i = 1; i < p.length; i++) {
    const d = p.charCodeAt(i) - p.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

export function checkPasswordPolicy(password: string, account: { email?: string; displayName?: string } = {}): PasswordProblem | null {
  if ([...password].length < MIN_PASSWORD_LENGTH) return 'too_short';
  const p = password.normalize('NFKC').toLowerCase().trim();
  const email = account.email?.normalize('NFKC').toLowerCase().trim();
  if (email) {
    const local = email.split('@')[0] ?? '';
    if (p === email || p === local) return 'matches_account';
  }
  const name = account.displayName?.normalize('NFKC').toLowerCase().trim();
  if (name && (p === name || p === name.replace(/\s+/g, ''))) return 'matches_account';
  if (isTrivial(p)) return 'too_simple';
  if (isCommonPassword(p)) return 'too_common';
  return null;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /** False for a wrong password and for anything that is not a valid hash. Never throws. */
  verify(stored: string, password: string): Promise<boolean>;
  /** Spend the same time as a real check when there is no account to check against. */
  verifyDummy(password: string): Promise<void>;
  /** True when `stored` was made with a weaker cost than the current one and should be replaced at next sign-in. */
  needsRehash(stored: string): boolean;
}

export function createPasswordHasher(cost: Argon2Cost = DEFAULT_ARGON2_COST): PasswordHasher {
  const options = { algorithm: ARGON2ID, memoryCost: cost.memoryCost, timeCost: cost.timeCost, parallelism: cost.parallelism };
  let dummy: Promise<string> | null = null;
  return {
    hash: (password) => hash(password, options),
    async verify(stored, password) {
      try {
        return await verify(stored, password);
      } catch {
        return false;
      }
    },
    async verifyDummy(password) {
      dummy ??= hash(randomBytes(24).toString('base64url'), options);
      try {
        await verify(await dummy, password);
      } catch {
        /* same cost either way */
      }
    },
    needsRehash(stored) {
      const m = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
      if (!m) return true;
      return Number(m[1]) < cost.memoryCost || Number(m[2]) < cost.timeCost || Number(m[3]) < cost.parallelism;
    },
  };
}
