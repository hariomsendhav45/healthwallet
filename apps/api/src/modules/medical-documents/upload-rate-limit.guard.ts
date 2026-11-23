import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { SecurityRateLimiter } from '../auth/security-rate-limiter.service';
import { AuthenticatedRequest } from '../auth/guards/auth.guard';

@Injectable()
export class MedicalDocumentUploadRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: SecurityRateLimiter) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.auth?.userId ?? 'anonymous';
    const ip = request.ip ?? 'unknown';
    this.limiter.consume(`medical-document-upload:user:${userId}`, 20, 60 * 60_000);
    this.limiter.consume(`medical-document-upload:ip:${ip}`, 40, 60 * 60_000);
    return true;
  }
}
