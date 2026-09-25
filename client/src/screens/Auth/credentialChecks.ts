import type { CredentialPolicy } from '../../api/types';

/**
 * Requisiti delle credenziali da mostrare prima del submit (briefing §7.1). Solo guida per l'utente:
 * l'autorità resta il server, i cui errori vengono mostrati comunque.
 * Stesse regole di chess-server `validation/validation.go`: lunghezze in byte, username valutato dopo il trim.
 * La policy arriva da `GET /auth/password-policy` o, in sua assenza, dalla riserva dell'adapter.
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

/** I requisiti che la policy chiede davvero: quelli disattivati non vengono mostrati. */
export function requiredChecks(policy: CredentialPolicy): readonly CredentialCheck[] {
  const { password: p } = policy;
  return CREDENTIAL_CHECKS.filter(
    (check) =>
      (check !== 'passwordUppercase' || p.requireUppercase) &&
      (check !== 'passwordLowercase' || p.requireLowercase) &&
      (check !== 'passwordDigit' || p.requireDigit),
  );
}

export function checkCredentials(
  policy: CredentialPolicy,
  input: { username: string; email: string; password: string },
): Record<CredentialCheck, boolean> {
  const { username: u, email: e, password: p } = policy;
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

export function allChecksPass(policy: CredentialPolicy, checks: Record<CredentialCheck, boolean>): boolean {
  return requiredChecks(policy).every((check) => checks[check]);
}
