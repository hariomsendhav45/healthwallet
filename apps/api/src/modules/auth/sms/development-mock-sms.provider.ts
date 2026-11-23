import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from './sms-provider';

@Injectable()
export class DevelopmentMockSmsProvider implements SmsProvider {
  constructor(config: ConfigService) {
    const environment = config.get<string>('NODE_ENV');
    if (!['development', 'test'].includes(environment ?? '')) {
      throw new Error('The mock SMS provider is available only in development and tests.');
    }
    if (
      !['development-mock', 'console'].includes(
        config.get<string>('SMS_PROVIDER', 'development-mock') ?? '',
      )
    ) {
      throw new Error(
        'No production SMS adapter is configured. Add a reviewed provider before enabling SMS.',
      );
    }
  }

  async sendOtp(): Promise<void> {
    throw new ServiceUnavailableException('No SMS delivery provider is configured.');
  }

  getProviderStatus() {
    return { name: 'development-mock', configured: false, developmentOnly: true };
  }
}
