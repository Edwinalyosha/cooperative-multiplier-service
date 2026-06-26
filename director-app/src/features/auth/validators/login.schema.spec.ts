import { loginSchema } from './login.schema';

describe('loginSchema', () => {
  it('passes with valid username and password', () => {
    const result = loginSchema.safeParse({ username: 'john_doe', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('passes with valid username containing hyphens and numbers', () => {
    const result = loginSchema.safeParse({ username: 'fa-admin_1', password: 'secret' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('fa-admin_1');
    }
  });

  it('trims surrounding whitespace and passes', () => {
    const result = loginSchema.safeParse({ username: '  fa_admin  ', password: 'secret' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe('fa_admin');
    }
  });

  it('fails when username is empty', () => {
    const result = loginSchema.safeParse({ username: '', password: 'secret' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('username');
    }
  });

  it('fails when username is whitespace only', () => {
    const result = loginSchema.safeParse({ username: '   ', password: 'secret' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain('Username cannot be blank');
    }
  });

  it('fails when username contains an internal space', () => {
    const result = loginSchema.safeParse({ username: 'fa admin', password: 'secret' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Username may only contain letters, numbers, '-' or '_'");
    }
  });

  it('fails when username contains a special character (@)', () => {
    const result = loginSchema.safeParse({ username: 'fa@admin', password: 'secret' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Username may only contain letters, numbers, '-' or '_'");
    }
  });

  it('fails when password is empty', () => {
    const result = loginSchema.safeParse({ username: 'john', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('password');
    }
  });

  it('fails when both fields are missing', () => {
    const result = loginSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toHaveLength(2);
    }
  });
});
