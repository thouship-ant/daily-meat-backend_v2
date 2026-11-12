import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException, ErrorCode } from '../../common/api-error';

/**
 * DigiLocker (Aadhaar e-KYC) connector. It stays OFF until the DigiLocker partner credentials are set
 * (DIGILOCKER_CLIENT_ID / DIGILOCKER_CLIENT_SECRET / DIGILOCKER_REDIRECT_URI): until then drivers upload the Aadhaar
 * photos and an admin checks them. The onboarding flow already branches on `enabled`; the OAuth round trip (authorise,
 * exchange the code, fetch the e-Aadhaar, mark the profile kyc_method = DIGILOCKER with kyc_verified_at) is the one
 * piece to add here once the credentials and the provider's API contract are available.
 */
@Injectable()
export class DigiLockerService {
  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return !!(this.config.get('DIGILOCKER_CLIENT_ID') && this.config.get('DIGILOCKER_CLIENT_SECRET') && this.config.get('DIGILOCKER_REDIRECT_URI'));
  }

  start(_userId: string): never {
    throw ApiException.badRequest(
      ErrorCode.UPSTREAM_FAILED,
      this.enabled
        ? 'DigiLocker verification is being connected. Please upload your Aadhaar card photos for now.'
        : 'DigiLocker is not available yet. Please upload your Aadhaar card photos.',
    );
  }
}
