import { loginSchema } from './login.schema';

describe('loginSchema', () => {
  it('passes with valid username and password', () => {
    const result = loginSchema.safeParse({ username: 'john.doe', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('fails when username is empty', () => {
    const result = loginSchema.safeParse({ username: '', password: 'secret' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('username');
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
