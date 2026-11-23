import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from './auth.guard';

const ROLES_KEY = 'healthvault:roles';
export const RequireRoles = (...roles: Array<'PATIENT' | 'DOCTOR' | 'ADMIN'>) =>
  SetMetadata(ROLES_KEY, roles);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Array<'PATIENT' | 'DOCTOR' | 'ADMIN'>>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.auth;
    if (!user || !roles.includes(user.role))
      throw new ForbiddenException('You do not have permission to access this resource.');
    if (user.role === 'DOCTOR' && user.doctorVerificationStatus !== 'APPROVED') {
      throw new ForbiddenException('Doctor approval is required for this action.');
    }
    return true;
  }
}
