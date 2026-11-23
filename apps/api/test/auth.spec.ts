import { ConfigService } from '@nestjs/config';
import { OtpPurpose, UserRole } from '../src/generated/prisma';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { SecurityRateLimiter } from '../src/modules/auth/security-rate-limiter.service';
import { SessionService } from '../src/modules/auth/session.service';
import { TokenService } from '../src/modules/auth/token.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { SmsProvider } from '../src/modules/auth/sms/sms-provider';
import { AuthenticatedRequest } from '../src/modules/auth/guards/auth.guard';
import { VerifyOtpDto } from '../src/modules/auth/dto/auth.dto';
import { TooManyRequestsException } from '../src/modules/auth/too-many-requests.exception';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { DevPasswordLoginDto } from '../src/modules/auth/dto/auth.dto';

const secret = 'healthvault-test-auth-secret-32-bytes-minimum';

describe('TokenService', () => {
  const tokens = new TokenService({ get: () => secret } as unknown as ConfigService);

  it('signs short-lived access tokens and rejects tampering', () => {
    const token = tokens.signAccessToken({ sub: 'user-id', sid: 'session-id', role: 'PATIENT' });
    expect(tokens.verifyAccessToken(token)?.sub).toBe('user-id');
    expect(tokens.verifyAccessToken(`${token.slice(0, -1)}x`)).toBeNull();
  });

  it('uses keyed, challenge-bound OTP hashes', () => {
    const one = tokens.hashOtp('challenge-one', '123456');
    expect(one).not.toContain('123456');
    expect(tokens.hashOtp('challenge-two', '123456')).not.toBe(one);
    expect(tokens.safeEqualHex(one, one)).toBe(true);
    expect(tokens.safeEqualHex(one, tokens.hashOtp('challenge-one', '654321'))).toBe(false);
  });
});

describe('SecurityRateLimiter', () => {
  it('rejects requests after the configured limit', () => {
    const limiter = new SecurityRateLimiter();
    limiter.consume('ip:test', 1, 60_000);
    expect(() => limiter.consume('ip:test', 1, 60_000)).toThrow(TooManyRequestsException);
  });
});

describe('RolesGuard', () => {
  it('denies doctor privileges while professional verification is pending', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(['DOCTOR']) };
    const guard = new RolesGuard(reflector as never);
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ auth: { role: 'DOCTOR', doctorVerificationStatus: 'PENDING' } }),
      }),
    };
    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });
});

describe('OtpService', () => {
  const tokens = new TokenService({ get: () => secret } as unknown as ConfigService);
  const sendOtp = jest.fn<Promise<void>, [string, string]>();
  const provider: SmsProvider = {
    sendOtp,
    getProviderStatus: () => ({ name: 'test', configured: true, developmentOnly: true }),
  };
  const prisma = {
    otpChallenge: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
    authAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    otpChallenge: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn((args) => Promise.resolve({ id: args.data.id })),
    },
  };
  const service = new OtpService(
    prisma as unknown as PrismaService,
    tokens,
    { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService,
    new SecurityRateLimiter(),
    provider,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    tx.otpChallenge.count.mockResolvedValue(0);
    tx.otpChallenge.findFirst.mockResolvedValue(null);
    prisma.otpChallenge.updateMany.mockResolvedValue({ count: 1 });
    prisma.otpChallenge.update.mockResolvedValue({});
    sendOtp.mockResolvedValue(undefined);
    prisma.$transaction.mockImplementation((operation: (trx: typeof tx) => unknown) =>
      operation(tx),
    );
    tx.otpChallenge.create.mockImplementation((args) => Promise.resolve({ id: args.data.id }));
  });

  it('generates a six-digit OTP, stores only its keyed hash, and expires it after five minutes', async () => {
    const before = Date.now();
    const result = await service.start({
      phoneNumber: '+919876543210',
      purpose: OtpPurpose.REGISTER,
      role: UserRole.PATIENT,
      ipAddress: '127.0.0.1',
      deliver: true,
    });
    const after = Date.now();
    const code = sendOtp.mock.calls[0]?.[1];
    const stored = tx.otpChallenge.create.mock.calls[0]?.[0].data as {
      id: string;
      otpHash: string;
      expiresAt: Date;
    };
    expect(code).toMatch(/^\d{6}$/);
    expect(stored.otpHash).toBe(tokens.hashOtp(result.challengeId, code!));
    expect(stored.otpHash).not.toContain(code);
    expect(stored.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 300_000);
    expect(stored.expiresAt.getTime()).toBeLessThanOrEqual(after + 300_000);
  });

  it('enforces resend cooldown before issuing another challenge', async () => {
    tx.otpChallenge.count.mockResolvedValue(1);
    tx.otpChallenge.findFirst.mockResolvedValue({ createdAt: new Date() });
    await expect(
      service.start({ phoneNumber: '+919876543210', purpose: OtpPurpose.LOGIN, deliver: false }),
    ).rejects.toThrow(TooManyRequestsException);
    expect(tx.otpChallenge.create).not.toHaveBeenCalled();
  });

  it('limits failed OTP attempts using a conditional database update', async () => {
    await service.recordFailedAttempt('challenge-id', '127.0.0.1', 'test device', 5);
    expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attempts: { lt: 5 } }),
      }),
    );
    expect(prisma.authAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'OTP_VERIFICATION_FAILED' }),
      }),
    );
  });

  it('masks SMS delivery failure in the public response and invalidates the undelivered challenge', async () => {
    sendOtp.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(
      service.start({ phoneNumber: '+919876543210', purpose: OtpPurpose.REGISTER, deliver: true }),
    ).resolves.toEqual(
      expect.objectContaining({ challengeId: expect.any(String), expiresInSeconds: 300 }),
    );
    expect(prisma.otpChallenge.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.authAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'OTP_DELIVERY_FAILED' }),
      }),
    );
  });
});

describe('AuthService OTP verification', () => {
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    phoneNumber: '+919876543210',
    phoneVerified: true,
    role: UserRole.PATIENT,
    accountStatus: 'ACTIVE',
    doctorVerificationStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  };
  const challenge = {
    id: '22222222-2222-4222-8222-222222222222',
    phoneNumber: user.phoneNumber,
    otpHash: 'a'.repeat(64),
    purpose: OtpPurpose.REGISTER,
    requestedRole: UserRole.PATIENT,
    expiresAt: new Date(Date.now() + 300_000),
    attempts: 0,
    maxAttempts: 5,
    consumedAt: null,
    createdAt: new Date(),
  };
  let consumed = false;
  const tx = {
    otpChallenge: { updateMany: jest.fn() },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    authAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    otpChallenge: { findUnique: jest.fn().mockResolvedValue(challenge) },
    authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(),
  };
  const otp = {
    hashMatches: jest.fn((_: string, code: string) => code === '123456'),
    recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
    checkVerificationRateLimit: jest.fn(),
  };
  const sessions = {
    createInTransaction: jest.fn().mockResolvedValue({
      sessionId: 'session-id',
      accessToken: 'access',
      refreshToken: 'refresh',
    }),
  };
  const service = new AuthService(
    prisma as unknown as PrismaService,
    otp as unknown as OtpService,
    sessions as unknown as SessionService,
    { get: () => undefined } as unknown as ConfigService,
    new SecurityRateLimiter(),
  );
  const request = {
    ip: '127.0.0.1',
    headers: { 'user-agent': 'unit-test' },
  } as unknown as AuthenticatedRequest;
  const dto: VerifyOtpDto = { challengeId: challenge.id, code: '123456', platform: 'WEB' };

  beforeEach(() => {
    jest.clearAllMocks();
    consumed = false;
    tx.otpChallenge.updateMany.mockImplementation(async () => {
      if (consumed) return { count: 0 };
      consumed = true;
      return { count: 1 };
    });
    tx.user.findUnique.mockResolvedValue(null);
    tx.user.create.mockResolvedValue(user);
    tx.user.update.mockResolvedValue(user);
    prisma.otpChallenge.findUnique.mockResolvedValue(challenge);
    prisma.$transaction.mockImplementation((operation: (trx: typeof tx) => unknown) =>
      operation(tx),
    );
    otp.hashMatches.mockImplementation((_: string, code: string) => code === '123456');
  });

  it('creates a verified patient account and session, and rejects OTP replay', async () => {
    const result = await service.verify(dto, request);
    expect(result.user.phoneVerified).toBe(true);
    expect(result.user.role).toBe('PATIENT');
    expect(result.accessToken).toBe('access');
    expect(sessions.createInTransaction).toHaveBeenCalledTimes(1);
    await expect(service.verify(dto, request)).rejects.toThrow(UnauthorizedException);
    expect(sessions.createInTransaction).toHaveBeenCalledTimes(1);
  });

  it('creates a PENDING doctor only after consuming a valid doctor registration OTP', async () => {
    const doctor = { ...user, id: '99999999-9999-4999-8999-999999999999', role: UserRole.DOCTOR, doctorVerificationStatus: 'PENDING' };
    prisma.otpChallenge.findUnique.mockResolvedValue({ ...challenge, requestedRole: UserRole.DOCTOR });
    tx.user.create.mockResolvedValue(doctor);
    tx.user.update.mockResolvedValue(doctor);
    const result = await service.verify(dto, request);
    expect(tx.user.create).toHaveBeenCalledWith({ data: expect.objectContaining({ role: UserRole.DOCTOR, phoneVerified: true, doctorVerificationStatus: 'PENDING' }) });
    expect(result.user.doctorVerificationStatus).toBe('PENDING');
    expect(sessions.createInTransaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid OTP and records a bounded attempt', async () => {
    await expect(service.verify({ ...dto, code: '000000' }, request)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(otp.recordFailedAttempt).toHaveBeenCalledWith(challenge.id, request.ip, 'unit-test', 5);
  });

  it('rejects expired OTP challenges without creating a session', async () => {
    prisma.otpChallenge.findUnique.mockResolvedValue({
      ...challenge,
      expiresAt: new Date(Date.now() - 1_000),
    });
    await expect(service.verify(dto, request)).rejects.toThrow(UnauthorizedException);
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });

  it('does not create an account for an unverified challenge', async () => {
    otp.hashMatches.mockReturnValue(false);
    await expect(service.verify(dto, request)).rejects.toThrow(UnauthorizedException);
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });

  it('rejects duplicate registration after consuming the challenge', async () => {
    tx.user.findUnique.mockResolvedValue(user);
    await expect(service.verify(dto, request)).rejects.toThrow(UnauthorizedException);
    expect(tx.otpChallenge.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ consumedAt: null }),
      }),
    );
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });

  it('allows a verified active patient to sign in by OTP', async () => {
    prisma.otpChallenge.findUnique.mockResolvedValue({ ...challenge, purpose: OtpPurpose.LOGIN });
    tx.user.findUnique.mockResolvedValue(user);
    const result = await service.verify(dto, request);
    expect(result.user.id).toBe(user.id);
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(sessions.createInTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not create a session for a suspended account', async () => {
    prisma.otpChallenge.findUnique.mockResolvedValue({ ...challenge, purpose: OtpPurpose.LOGIN });
    tx.user.findUnique.mockResolvedValue({ ...user, accountStatus: 'SUSPENDED' });
    await expect(service.verify(dto, request)).rejects.toThrow(UnauthorizedException);
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });

  it('revokes all active sessions in one transaction', async () => {
    const transaction = {
      refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      authAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((operation: (trx: typeof transaction) => unknown) =>
      operation(transaction),
    );
    const result = await service.logoutAll(user.id, request);
    expect(result.revokedCount).toBe(3);
    expect(transaction.refreshSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: user.id, revokedAt: null } }),
    );
    expect(transaction.authAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'ALL_SESSIONS_REVOKED' }),
      }),
    );
  });
});

describe('development password login role boundary', () => {
  it('does not allow the patient testing password to authenticate a doctor account', async () => {
    const doctor = { id: '77777777-7777-4777-8777-777777777777', phoneNumber: '+919888888888', phoneVerified: true, isDevelopmentTestAccount: true, role: UserRole.DOCTOR, doctorVerificationStatus: 'APPROVED', accountStatus: 'ACTIVE' };
    const tx = { user: { findUnique: jest.fn().mockResolvedValue(doctor), create: jest.fn(), update: jest.fn() }, authAuditLog: { create: jest.fn() } };
    const prisma = { user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() }, authAuditLog: { create: jest.fn() }, $transaction: jest.fn((fn: (value: typeof tx) => unknown) => fn(tx)) };
    const sessions = { createInTransaction: jest.fn() };
    const settings: Record<string,string> = { NODE_ENV: 'development', DEV_PASSWORD_AUTH_ENABLED: 'true', DEV_TEST_PHONE: doctor.phoneNumber, DEV_TEST_PASSWORD: 'PatientOnlySyntheticPassword2026' };
    const service = new AuthService(prisma as unknown as PrismaService, {} as OtpService, sessions as unknown as SessionService, {get:(key:string)=>settings[key]} as unknown as ConfigService, new SecurityRateLimiter());
    const dto: DevPasswordLoginDto = { countryCode: '+91', mobileNumber: doctor.phoneNumber.slice(3), password: settings.DEV_TEST_PASSWORD! };
    const request = {ip:'127.0.0.1',headers:{'user-agent':'test'}} as unknown as AuthenticatedRequest;
    await expect(service.devPasswordLogin(dto,request)).rejects.toThrow(UnauthorizedException);
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(sessions.createInTransaction).not.toHaveBeenCalled();
  });
});

describe('SessionService refresh and revocation', () => {
  const tokens = new TokenService({ get: () => secret } as unknown as ConfigService);
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const oldRefresh = `${sessionId}.old-random-refresh-secret-value-which-is-long-enough`;
  const session = {
    id: sessionId,
    userId: '11111111-1111-4111-8111-111111111111',
    tokenHash: tokens.hashRefreshToken(oldRefresh),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null as Date | null,
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      role: UserRole.PATIENT,
      accountStatus: 'ACTIVE',
    },
  };
  const tx = {
    refreshSession: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    authAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { $transaction: jest.fn() };
  const service = new SessionService(prisma as unknown as PrismaService, tokens);

  beforeEach(() => {
    jest.clearAllMocks();
    session.tokenHash = tokens.hashRefreshToken(oldRefresh);
    session.revokedAt = null;
    session.expiresAt = new Date(Date.now() + 60_000);
    tx.refreshSession.findUnique.mockImplementation(async () => ({
      ...session,
      user: session.user,
    }));
    tx.refreshSession.updateMany.mockImplementation(async (args) => {
      if (args.data.revokedAt) {
        session.revokedAt = args.data.revokedAt;
        return { count: 1 };
      }
      if (args.where.tokenHash === session.tokenHash) {
        session.tokenHash = args.data.tokenHash;
        return { count: 1 };
      }
      return { count: 0 };
    });
    prisma.$transaction.mockImplementation((operation: (trx: typeof tx) => unknown) =>
      operation(tx),
    );
  });

  it('rotates a refresh credential and detects reuse of the previous token', async () => {
    const rotated = await service.rotate(oldRefresh);
    expect(rotated.refreshToken).not.toBe(oldRefresh);
    expect(session.tokenHash).toBe(tokens.hashRefreshToken(rotated.refreshToken));
    await expect(service.rotate(oldRefresh)).rejects.toThrow(UnauthorizedException);
    expect(session.revokedAt).toBeInstanceOf(Date);
    expect(tx.authAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: 'SESSION_REUSE_DETECTED' }),
      }),
    );
  });

  it('expires a session that is past its refresh lifetime', async () => {
    session.expiresAt = new Date(Date.now() - 1_000);
    tx.refreshSession.update.mockImplementation(async ({ data }) => {
      session.revokedAt = data.revokedAt;
      return session;
    });
    await expect(service.rotate(oldRefresh)).rejects.toThrow(UnauthorizedException);
    expect(session.revokedAt).toBeInstanceOf(Date);
  });
});
