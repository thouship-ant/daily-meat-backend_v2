import { envValidationSchema } from './env.validation';

describe('env validation', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'a-test-secret-of-sufficient-length', REFRESH_TOKEN_SECRET: 'another-test-secret-long-enough' };

  it('a blank number (as in a copied .env.example) means "use the default"', () => {
    const { error, value } = envValidationSchema.validate({ ...base, COD_MAX_AMOUNT: '', OTP_TTL_SECONDS: '', DRIVER_DEPOSIT_PRICE: '' }, { allowUnknown: true });
    expect(error).toBeUndefined();
    expect(value.COD_MAX_AMOUNT).toBe(3000);
    expect(value.DRIVER_DEPOSIT_PRICE).toBe(1500);
  });

  it('a real number is still checked', () => {
    const { error } = envValidationSchema.validate({ ...base, COD_MAX_AMOUNT: 'lots' }, { allowUnknown: true });
    expect(error).toBeDefined();
  });
});
