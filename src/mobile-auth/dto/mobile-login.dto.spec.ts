import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MobileLoginDto } from './mobile-login.dto';

describe('MobileLoginDto', () => {
  it('passes with valid username and password', async () => {
    const dto = plainToInstance(MobileLoginDto, {
      username: 'john.doe',
      password: 'secret123',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails when username is an empty string', async () => {
    const dto = plainToInstance(MobileLoginDto, {
      username: '',
      password: 'secret123',
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'username')).toBe(true);
  });

  it('fails when password is missing', async () => {
    const dto = plainToInstance(MobileLoginDto, { username: 'john.doe' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'password')).toBe(true);
  });

  it('fails when both fields are missing', async () => {
    const dto = plainToInstance(MobileLoginDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(2);
  });
});
