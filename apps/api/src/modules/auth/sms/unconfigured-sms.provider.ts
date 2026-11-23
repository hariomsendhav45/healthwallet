import { ServiceUnavailableException } from '@nestjs/common';
import { SmsProvider } from './sms-provider';

/** Allows production startup without pretending SMS delivery is configured. */
export class UnconfiguredSmsProvider implements SmsProvider {
  async sendOtp(): Promise<void> {
    throw new ServiceUnavailableException('SMS delivery is not configured.');
  }

  getProviderStatus() {
    return { name: 'unconfigured', configured: false, developmentOnly: false };
  }
}
