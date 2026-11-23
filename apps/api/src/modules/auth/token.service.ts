import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface AccessClaims {
  sub: string;
  sid: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  iat: number;
  exp: number;
}

@Injectable()
export class TokenService {
  readonly accessTokenSeconds = 15 * 60;
  readonly refreshTokenSeconds = 30 * 24 * 60 * 60;
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.get<string>('AUTH_SECRET') ?? config.get<string>('SESSION_SECRET') ?? '';
    if (Buffer.byteLength(this.secret) < 32) {
      throw new Error('AUTH_SECRET or SESSION_SECRET must contain at least 32 bytes.');
    }
  }

  signAccessToken(claims: Omit<AccessClaims, 'iat' | 'exp'>): string {
    const now = Math.floor(Date.now() / 1000);
    const header = this.encode({ alg: 'HS256', typ: 'JWT' });
    const payload = this.encode({ ...claims, iat: now, exp: now + this.accessTokenSeconds });
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${this.hmac(unsigned)}`;
  }

  verifyAccessToken(token: string): AccessClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(this.hmac(unsigned));
    const supplied = Buffer.from(parts[2]);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
        alg?: string;
      };
      const claims = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as AccessClaims;
      if (
        header.alg !== 'HS256' ||
        typeof claims.sub !== 'string' ||
        typeof claims.sid !== 'string' ||
        !['PATIENT', 'DOCTOR', 'ADMIN'].includes(claims.role) ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= Math.floor(Date.now() / 1000)
      )
        return null;
      return claims;
    } catch {
      return null;
    }
  }

  createRefreshToken(sessionId: string): string {
    return `${sessionId}.${randomBytes(48).toString('base64url')}`;
  }

  hashRefreshToken(token: string): string {
    return this.hmac(`refresh:${token}`);
  }

  hashOtp(challengeId: string, code: string): string {
    return this.hmac(`otp:${challengeId}:${code}`);
  }

  safeEqualHex(left: string, right: string): boolean {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
  }

  private hmac(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('hex');
  }

  private encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }
}
