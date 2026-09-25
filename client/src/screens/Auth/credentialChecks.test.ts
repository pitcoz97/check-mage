import { describe, expect, it } from 'vitest';

import { FALLBACK_CREDENTIAL_POLICY } from '../../api/adapter';
import type { CredentialPolicy } from '../../api/types';
import { allChecksPass, checkCredentials, requiredChecks } from './credentialChecks';

const valid = { username: 'mario_1', email: 'mario@test.it', password: 'Password1' };
const policy = FALLBACK_CREDENTIAL_POLICY;
const check = (input: Partial<typeof valid>) => checkCredentials(policy, { ...valid, ...input });

describe('checkCredentials (validation/validation.go)', () => {
  it('credenziali valide', () => {
    expect(allChecksPass(policy, check({}))).toBe(true);
  });

  it('username: lunghezza dopo il trim, caratteri ammessi', () => {
    expect(check({ username: 'ab' }).usernameLength).toBe(false);
    expect(check({ username: '  abc  ' }).usernameLength).toBe(true);
    expect(check({ username: 'a'.repeat(21) }).usernameLength).toBe(false);
    expect(check({ username: 'mario-rossi' }).usernameChars).toBe(false);
    expect(check({ username: '' }).usernameChars).toBe(false);
  });

  it('email: stesso formato del server', () => {
    expect(check({ email: 'mario@test' }).emailFormat).toBe(false);
    expect(check({ email: 'mario.rossi+x@sub.test.it' }).emailFormat).toBe(true);
  });

  it('password: lunghezza in byte, maiuscola, minuscola, cifra', () => {
    expect(check({ password: 'Pass1' }).passwordLength).toBe(false);
    expect(check({ password: `Pa1${'a'.repeat(69)}` }).passwordLength).toBe(true);
    expect(check({ password: `Pa1${'a'.repeat(70)}` }).passwordLength).toBe(false);
    // 38 caratteri ma 73 byte: il limite è in byte, come `len()` in Go
    expect(check({ password: `Pa1${'è'.repeat(35)}` }).passwordLength).toBe(false);
    expect(check({ password: 'password1' }).passwordUppercase).toBe(false);
    expect(check({ password: 'PASSWORD1' }).passwordLowercase).toBe(false);
    expect(check({ password: 'Password' }).passwordDigit).toBe(false);
  });
});

describe('policy diversa da quella di riserva (GET /auth/password-policy)', () => {
  const relaxed: CredentialPolicy = {
    username: { minLength: 5, maxLength: 8, pattern: /^[a-z]+$/ },
    email: policy.email,
    password: { minBytes: 4, maxBytes: 10, requireUppercase: false, requireLowercase: true, requireDigit: false },
  };

  it('usa i limiti e la regex ricevuti', () => {
    const result = checkCredentials(relaxed, { username: 'mario', email: 'm@test.it', password: 'abcd' });
    expect(result).toMatchObject({ usernameLength: true, usernameChars: true, passwordLength: true });
    expect(checkCredentials(relaxed, { ...valid, username: 'mario_1' }).usernameChars).toBe(false);
    expect(checkCredentials(relaxed, { ...valid, username: 'mariorossi' }).usernameLength).toBe(false);
  });

  it('i requisiti disattivati non vengono mostrati né bloccano il submit', () => {
    expect(requiredChecks(relaxed)).toEqual(['usernameLength', 'usernameChars', 'emailFormat', 'passwordLength', 'passwordLowercase']);
    expect(allChecksPass(relaxed, checkCredentials(relaxed, { username: 'mario', email: 'm@test.it', password: 'abcd' }))).toBe(true);
  });
});
