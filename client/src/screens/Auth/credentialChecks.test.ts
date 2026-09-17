import { describe, expect, it } from 'vitest';

import { allChecksPass, checkCredentials } from './credentialChecks';

const valid = { username: 'mario_1', email: 'mario@test.it', password: 'Password1' };

describe('checkCredentials (validation/validation.go)', () => {
  it('credenziali valide', () => {
    expect(allChecksPass(checkCredentials(valid))).toBe(true);
  });

  it('username: lunghezza dopo il trim, caratteri ammessi', () => {
    expect(checkCredentials({ ...valid, username: 'ab' }).usernameLength).toBe(false);
    expect(checkCredentials({ ...valid, username: '  abc  ' }).usernameLength).toBe(true);
    expect(checkCredentials({ ...valid, username: 'a'.repeat(21) }).usernameLength).toBe(false);
    expect(checkCredentials({ ...valid, username: 'mario-rossi' }).usernameChars).toBe(false);
    expect(checkCredentials({ ...valid, username: '' }).usernameChars).toBe(false);
  });

  it('email: stesso formato del server', () => {
    expect(checkCredentials({ ...valid, email: 'mario@test' }).emailFormat).toBe(false);
    expect(checkCredentials({ ...valid, email: 'mario.rossi+x@sub.test.it' }).emailFormat).toBe(true);
  });

  it('password: lunghezza in byte, maiuscola, minuscola, cifra', () => {
    expect(checkCredentials({ ...valid, password: 'Pass1' }).passwordLength).toBe(false);
    expect(checkCredentials({ ...valid, password: `Pa1${'a'.repeat(69)}` }).passwordLength).toBe(true);
    expect(checkCredentials({ ...valid, password: `Pa1${'a'.repeat(70)}` }).passwordLength).toBe(false);
    // 38 caratteri ma 73 byte: il limite è in byte, come `len()` in Go
    expect(checkCredentials({ ...valid, password: `Pa1${'è'.repeat(35)}` }).passwordLength).toBe(false);
    expect(checkCredentials({ ...valid, password: 'password1' }).passwordUppercase).toBe(false);
    expect(checkCredentials({ ...valid, password: 'PASSWORD1' }).passwordLowercase).toBe(false);
    expect(checkCredentials({ ...valid, password: 'Password' }).passwordDigit).toBe(false);
  });
});
