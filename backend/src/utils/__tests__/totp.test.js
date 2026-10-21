const {
  base32Encode,
  base32Decode,
  generateSecret,
  generateTotp,
  verifyTotp,
  buildOtpauthUri,
  generateRecoveryCodes,
  hashRecoveryCode,
} = require('../totp');

// RFC 6238 Appendix B, SHA1 rows. The seed is the ASCII string
// "12345678901234567890"; codes are 8 digits in the RFC.
const RFC_SEED = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totp: RFC 6238 test vectors (SHA1)', () => {
  test.each(RFC_VECTORS)('T=%s -> %s (8 digits)', (time, expected) => {
    expect(generateTotp(RFC_SEED, { time, digits: 8 })).toBe(expected);
  });

  test.each(RFC_VECTORS)('T=%s -> last 6 digits by default', (time, expected) => {
    expect(generateTotp(RFC_SEED, { time })).toBe(expected.slice(-6));
  });

  test('a base32 secret string is accepted the same as the raw key', () => {
    const b32 = base32Encode(RFC_SEED);
    expect(b32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(generateTotp(b32, { time: 59, digits: 8 })).toBe('94287082');
  });
});

describe('totp: base32', () => {
  test('round-trips arbitrary bytes', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 17, 99]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  test('decode tolerates lowercase, spaces and padding', () => {
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq====').equals(RFC_SEED)).toBe(true);
  });

  test('decode rejects characters outside the alphabet', () => {
    expect(() => base32Decode('ABC1')).toThrow();
  });
});

describe('totp: verifyTotp', () => {
  const secret = base32Encode(RFC_SEED);
  const time = 1111111111; // step 37037037
  const step = Math.floor(time / 30);

  test('accepts the current step and returns it', () => {
    expect(verifyTotp(secret, '050471', { time })).toBe(step);
  });

  test('accepts one step behind and one step ahead', () => {
    const prev = generateTotp(secret, { time: time - 30 });
    const next = generateTotp(secret, { time: time + 30 });
    expect(verifyTotp(secret, prev, { time })).toBe(step - 1);
    expect(verifyTotp(secret, next, { time })).toBe(step + 1);
  });

  test('rejects codes two steps away', () => {
    const old = generateTotp(secret, { time: time - 60 });
    const future = generateTotp(secret, { time: time + 60 });
    expect(verifyTotp(secret, old, { time })).toBeNull();
    expect(verifyTotp(secret, future, { time })).toBeNull();
  });

  test('rejects a wrong code, malformed input, and empty values', () => {
    expect(verifyTotp(secret, '000000', { time })).toBeNull();
    expect(verifyTotp(secret, '12345', { time })).toBeNull();
    expect(verifyTotp(secret, 'abcdef', { time })).toBeNull();
    expect(verifyTotp(secret, '', { time })).toBeNull();
    expect(verifyTotp(secret, null, { time })).toBeNull();
    expect(verifyTotp(null, '050471', { time })).toBeNull();
  });

  test('tolerates a space in the middle of the code (as authenticator apps display it)', () => {
    expect(verifyTotp(secret, '050 471', { time })).toBe(step);
  });

  test('refuses a step at or before lastUsedStep (replay protection)', () => {
    expect(verifyTotp(secret, '050471', { time, lastUsedStep: step })).toBeNull();
    const next = generateTotp(secret, { time: time + 30 });
    expect(verifyTotp(secret, next, { time, lastUsedStep: step })).toBe(step + 1);
  });
});

describe('totp: helpers', () => {
  test('generateSecret returns a 32-char base32 string (160 bits)', () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateSecret()).not.toBe(s);
  });

  test('buildOtpauthUri encodes issuer and account', () => {
    const uri = buildOtpauthUri({ secret: 'ABC', accountName: 'a.b+c@x.com', issuer: 'Izaya EIS' });
    expect(uri).toBe('otpauth://totp/Izaya%20EIS:a.b%2Bc%40x.com?secret=ABC&issuer=Izaya%20EIS&algorithm=SHA1&digits=6&period=30');
  });

  test('generateRecoveryCodes returns 10 unique codes; hashing normalizes case and dashes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    codes.forEach((c) => expect(c).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/));
    const c = codes[0];
    expect(hashRecoveryCode(c)).toBe(hashRecoveryCode(c.toUpperCase().replace('-', ' ')));
    expect(hashRecoveryCode(c)).toMatch(/^[0-9a-f]{64}$/);
  });
});
