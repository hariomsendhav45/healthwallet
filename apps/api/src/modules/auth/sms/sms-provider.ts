export const SMS_PROVIDER = Symbol('SMS_PROVIDER');

export interface SmsProvider {
  sendOtp(phoneNumber: string, otp: string): Promise<void>;
  getProviderStatus(): { name: string; configured: boolean; developmentOnly: boolean };
}
