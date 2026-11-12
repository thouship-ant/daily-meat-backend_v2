import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  APP_BASE_URL: Joi.string().uri().default('http://localhost:3000'),
  CORS_ORIGINS: Joi.string().allow('').default(''), // comma separated; empty = reflect request origin

  DATABASE_URL: Joi.string().required(),
  REDIS_URL: Joi.string().allow('').default(''),

  JWT_SECRET: Joi.string().min(16).required(),
  JWT_EXPIRES_IN: Joi.string().default('15m'),
  REFRESH_TOKEN_SECRET: Joi.string().min(16).required(),
  REFRESH_TOKEN_EXPIRES_IN: Joi.string().default('30d'),

  // Business rules
  COD_MAX_AMOUNT: Joi.number().default(3000),
  OTP_TTL_SECONDS: Joi.number().default(600),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
  MAX_ACCOUNTS_PER_DEVICE: Joi.number().default(2),
  TEST_ACCOUNT_PHONE_MARKER: Joi.string().allow('').default(''), // e.g. 9000000000 (store reviewer account)
  TEST_ACCOUNT_OTP: Joi.string().default('123456'),
  ARRIVAL_RADIUS_METERS: Joi.number().default(150),

  // Payments (Cashfree)
  CASHFREE_ENV: Joi.string().valid('TEST', 'PROD').default('TEST'),
  CASHFREE_APP_ID: Joi.string().allow('').default(''),
  CASHFREE_SECRET_KEY: Joi.string().allow('').default(''),

  // Messaging
  SMTP_HOST: Joi.string().allow('').default(''),
  SMTP_PORT: Joi.number().default(587),
  SMTP_USER: Joi.string().allow('').default(''),
  SMTP_PASS: Joi.string().allow('').default(''),
  SMTP_FROM: Joi.string().allow('').default(''),
  SMS_FORTIUS_API_KEY: Joi.string().allow('').default(''),
  SMS_FORTIUS_SENDER_ID: Joi.string().allow('').default(''),
  SMS_FORTIUS_TEMPLATE_ID: Joi.string().allow('').default(''),
  SMS_FORTIUS_BASE_URL: Joi.string().allow('').default(''),

  // Push
  EXPO_ACCESS_TOKEN: Joi.string().allow('').default(''),
  ANDROID_ALARM_CHANNEL_ID: Joi.string().default('order-alarm'),
  ANDROID_NOTIFICATION_CHANNEL_ID: Joi.string().allow('').default(''),
  PUSH_TOKEN_MAX_CHARS: Joi.number().default(255),

  // Storage (S3 compatible)
  AWS_REGION: Joi.string().allow('').default(''),
  AWS_ENDPOINT: Joi.string().allow('').default(''),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  S3_BUCKET: Joi.string().allow('').default(''),
  S3_PUBLIC_BASE_URL: Joi.string().allow('').default(''),
  // Aadhaar / selfie photos: a PRIVATE bucket (never given a public URL). Empty = the S3_BUCKET above (keys under kyc/).
  S3_KYC_BUCKET: Joi.string().allow('').default(''),
  // New driver starting deposit (T-shirt + basket): list price (struck out) and the offer price actually charged
  DRIVER_DEPOSIT_LIST_PRICE: Joi.number().default(2000),
  DRIVER_DEPOSIT_PRICE: Joi.number().default(1500),
  // DigiLocker (Aadhaar e-KYC). Empty = off: drivers upload the Aadhaar photos and an admin checks them
  DIGILOCKER_CLIENT_ID: Joi.string().allow('').default(''),
  DIGILOCKER_CLIENT_SECRET: Joi.string().allow('').default(''),
  DIGILOCKER_REDIRECT_URI: Joi.string().allow('').default(''),

  // App version gate
  APP_ANDROID_LATEST_BUILD: Joi.number().default(0),
  APP_ANDROID_STORE_URL: Joi.string().allow('').default(''),
  APP_IOS_LATEST_BUILD: Joi.number().default(0),
  APP_IOS_STORE_URL: Joi.string().allow('').default(''),

  SWAGGER_ENABLED: Joi.boolean().default(true),
});
