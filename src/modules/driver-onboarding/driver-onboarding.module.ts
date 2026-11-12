import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DigiLockerService } from './digilocker.service';
import { DriverOnboardingService } from './driver-onboarding.service';

@Module({
  imports: [NotificationsModule],
  providers: [DriverOnboardingService, DigiLockerService],
  exports: [DriverOnboardingService, DigiLockerService],
})
export class DriverOnboardingModule {}
