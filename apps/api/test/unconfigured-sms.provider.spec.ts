import { ServiceUnavailableException } from '@nestjs/common';
import { UnconfiguredSmsProvider } from '../src/modules/auth/sms/unconfigured-sms.provider';

describe('UnconfiguredSmsProvider', () => {
  it('reports delivery as unavailable and does not pretend to send an OTP', async () => {
    const provider = new UnconfiguredSmsProvider();
    expect(provider.getProviderStatus()).toEqual({
      name: 'unconfigured',
      configured: false,
      developmentOnly: false,
    });
    await expect(provider.sendOtp()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
