import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { HubsModule } from '../hubs/hubs.module';
import { DriverInterestService } from './driver-interest.service';
import { DigiLockerService } from './digilocker.service';
import { DriverOnboardingService } from './driver-onboarding.service';

@Module({
  imports: [NotificationsModule, HubsModule],
  providers: [DriverOnboardingService, DigiLockerService, DriverInterestService],
  exports: [DriverOnboardingService, DigiLockerService, DriverInterestService],
})
export class DriverOnboardingModule {}
