import { CREDENTIAL_POLICY } from '../../api/adapter';

/**
 * Requisiti delle credenziali da mostrare prima del submit (briefing §7.1). Solo guida per l'utente:
 * l'autorità resta il server, i cui errori vengono mostrati comunque.
 * Stesse regole di chess-server `validation/validation.go`: lunghezze in byte, username valutato dopo il trim.
 */

export const CREDENTIAL_CHECKS = [
  'usernameLength',
  'usernameChars',
  'emailFormat',
  'passwordLength',
  'passwordUppercase',
  'passwordLowercase',
  'passwordDigit',
] as const;

export type CredentialCheck = (typeof CREDENTIAL_CHECKS)[number];

const byteLength = (value: string) => new TextEncoder().encode(value).length;

export function checkCredentials(input: { username: string; email: string; password: string }): Record<CredentialCheck, boolean> {
  const { username: u, email: e, password: p } = CREDENTIAL_POLICY;
  const name = input.username.trim();
  const pwd = byteLength(input.password);
  return {
    usernameLength: byteLength(name) >= u.minLength && byteLength(name) <= u.maxLength,
    usernameChars: name.length > 0 && u.pattern.test(name),
    emailFormat: e.pattern.test(input.email),
    passwordLength: pwd >= p.minBytes && pwd <= p.maxBytes,
    passwordUppercase: /[A-Z]/.test(input.password),
    passwordLowercase: /[a-z]/.test(input.password),
    passwordDigit: /[0-9]/.test(input.password),
  };
}

export function allChecksPass(checks: Record<CredentialCheck, boolean>): boolean {
  return CREDENTIAL_CHECKS.every((check) => checks[check]);
}
