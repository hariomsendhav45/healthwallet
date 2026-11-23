import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import {
  DoctorAccessRequestStatus,
  MedicalRecordAccessGrantStatus,
  MedicalSharePermissionType,
  MedicalShareStatus,
  MedicalSharingEventType,
  Prisma,
} from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../auth/guards/auth.guard';
import { TooManyRequestsException } from '../auth/too-many-requests.exception';
import { CreateMedicalShareSessionDto, UpdateDoctorProfileDto } from './dto/medical-sharing.dto';

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const patientSessionSelect = {
  id: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  revokedAt: true,
  maxUses: true,
  useCount: true,
  permissions: { select: { permissionType: true } },
  documents: {
    select: {
      medicalDocument: { select: { id: true, title: true, category: true, documentDate: true } },
    },
  },
} satisfies Prisma.MedicalShareSessionSelect;

@Injectable()
export class MedicalSharingService {
  private readonly maxDurationMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.maxDurationMinutes = Number(config.get('MEDICAL_SHARE_MAX_DURATION_MINUTES', '60'));
    if (
      !Number.isInteger(this.maxDurationMinutes) ||
      this.maxDurationMinutes < 5 ||
      this.maxDurationMinutes > 60
    )
      throw new Error('MEDICAL_SHARE_MAX_DURATION_MINUTES must be between 5 and 60.');
  }

  async createSession(
    userId: string,
    dto: CreateMedicalShareSessionDto,
    request: AuthenticatedRequest,
  ) {
    if (dto.durationMinutes > this.maxDurationMinutes)
      throw new ConflictException('The selected sharing duration is not available.');
    const permissions = [...new Set(dto.permissionTypes)];
    if (permissions.length !== dto.permissionTypes.length)
      throw new ConflictException('Remove duplicate sharing categories.');
    const documentIds = [...new Set(dto.medicalDocumentIds ?? [])];
    if (documentIds.length !== (dto.medicalDocumentIds ?? []).length)
      throw new ConflictException('Remove duplicate medical reports.');
    const permitsDocuments = permissions.includes(MedicalSharePermissionType.MEDICAL_DOCUMENTS);
    if (permitsDocuments !== documentIds.length > 0)
      throw new ConflictException(
        'Select one or more specific reports when sharing medical documents.',
      );
    const profile = await this.patientProfile(userId);
    if (documentIds.length) {
      const count = await this.prisma.medicalDocument.count({
        where: {
          id: { in: documentIds },
          patientProfileId: profile.id,
          uploadedByUserId: userId,
          deletedAt: null,
          uploadStatus: 'AVAILABLE',
        },
      });
      if (count !== documentIds.length)
        throw new NotFoundException('One or more selected reports are unavailable.');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + dto.durationMinutes * 60_000);
    const created = await this.prisma.$transaction(async (tx) => {
      const session = await tx.medicalShareSession.create({
        data: {
          patientProfileId: profile.id,
          createdByUserId: userId,
          tokenHash: tokenHash(token),
          expiresAt,
          maxUses: 5,
          permissions: { create: permissions.map((permissionType) => ({ permissionType })) },
          documents: { create: documentIds.map((medicalDocumentId) => ({ medicalDocumentId })) },
        },
        select: patientSessionSelect,
      });
      await this.audit(tx, {
        patientProfileId: profile.id,
        actorUserId: userId,
        shareSessionId: session.id,
        eventType: MedicalSharingEventType.SHARE_SESSION_CREATED,
        request,
        metadata: {
          permissionCount: permissions.length,
          documentCount: documentIds.length,
          durationMinutes: dto.durationMinutes,
        },
      });
      return session;
    });
    return { session: created, token };
  }

  async listSessions(userId: string) {
    const profile = await this.patientProfile(userId);
    await this.expireSessions(profile.id);
    const sessions = await this.prisma.medicalShareSession.findMany({
      where: { patientProfileId: profile.id },
      select: {
        ...patientSessionSelect,
        accessRequests: {
          select: {
            id: true,
            status: true,
            requestedAt: true,
            accessGrant: { select: { status: true, expiresAt: true, revokedAt: true } },
            doctor: {
              select: {
                doctorProfile: {
                  select: {
                    fullName: true,
                    professionalRegistrationNo: true,
                    registrationAuthority: true,
                  },
                },
              },
            },
          },
          orderBy: { requestedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { sessions };
  }

  async getSession(userId: string, id: string) {
    const profile = await this.patientProfile(userId);
    const session = await this.prisma.medicalShareSession.findFirst({
      where: { id, patientProfileId: profile.id },
      select: {
        ...patientSessionSelect,
        accessRequests: {
          select: {
            id: true,
            status: true,
            requestedAt: true,
            reviewedAt: true,
            expiresAt: true,
            accessGrant: { select: { status: true, expiresAt: true, revokedAt: true } },
            doctor: {
              select: {
                doctorProfile: {
                  select: {
                    fullName: true,
                    professionalRegistrationNo: true,
                    registrationAuthority: true,
                  },
                },
              },
            },
          },
          orderBy: { requestedAt: 'desc' },
        },
      },
    });
    if (!session) throw new NotFoundException('Sharing session not found.');
    return { session };
  }

  async revokeSession(userId: string, id: string, request: AuthenticatedRequest) {
    const profile = await this.patientProfile(userId);
    return this.prisma.$transaction(
      async (tx) => {
        const session = await tx.medicalShareSession.findFirst({
          where: { id, patientProfileId: profile.id },
        });
        if (!session) throw new NotFoundException('Sharing session not found.');
        if (session.status !== MedicalShareStatus.REVOKED) {
          const now = new Date();
          await tx.medicalShareSession.update({
            where: { id },
            data: { status: MedicalShareStatus.REVOKED, revokedAt: now },
          });
          await tx.medicalRecordAccessGrant.updateMany({
            where: { shareSessionId: id, status: MedicalRecordAccessGrantStatus.ACTIVE },
            data: {
              status: MedicalRecordAccessGrantStatus.REVOKED,
              revokedAt: now,
              revokedByUserId: userId,
            },
          });
          await tx.doctorAccessRequest.updateMany({
            where: {
              shareSessionId: id,
              status: {
                in: [DoctorAccessRequestStatus.PENDING, DoctorAccessRequestStatus.APPROVED],
              },
            },
            data: {
              status: DoctorAccessRequestStatus.REVOKED,
              reviewedAt: now,
              reviewedByUserId: userId,
            },
          });
          await this.audit(tx, {
            patientProfileId: profile.id,
            actorUserId: userId,
            shareSessionId: id,
            eventType: MedicalSharingEventType.SHARE_SESSION_REVOKED,
            request,
          });
        }
        return { revoked: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async patientRequests(userId: string) {
    const profile = await this.patientProfile(userId);
    await this.expireSessions(profile.id);
    const requests = await this.prisma.doctorAccessRequest.findMany({
      where: { patientProfileId: profile.id, status: DoctorAccessRequestStatus.PENDING },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        expiresAt: true,
        shareSession: {
          select: {
            id: true,
            permissions: { select: { permissionType: true } },
            documents: {
              select: { medicalDocument: { select: { id: true, title: true, category: true } } },
            },
          },
        },
        doctor: {
          select: {
            doctorProfile: {
              select: {
                fullName: true,
                professionalRegistrationNo: true,
                registrationAuthority: true,
              },
            },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return { requests };
  }

  async reviewRequest(
    userId: string,
    id: string,
    decision: 'approve' | 'reject',
    request: AuthenticatedRequest,
  ) {
    const profile = await this.patientProfile(userId);
    const result = await this.prisma.$transaction(
      async (tx) => {
        const accessRequest = await tx.doctorAccessRequest.findFirst({
          where: { id, patientProfileId: profile.id },
          include: { shareSession: true },
        });
        if (!accessRequest) throw new NotFoundException('Access request not found.');
        const now = new Date();
        if (accessRequest.status !== DoctorAccessRequestStatus.PENDING)
          throw new ConflictException('This access request has already been reviewed.');
        if (
          accessRequest.expiresAt <= now ||
          accessRequest.shareSession.status !== MedicalShareStatus.ACTIVE ||
          accessRequest.shareSession.expiresAt <= now
        ) {
          await tx.doctorAccessRequest.update({
            where: { id },
            data: { status: DoctorAccessRequestStatus.EXPIRED, reviewedAt: now },
          });
          return { expired: true as const };
        }
        const changed = await tx.doctorAccessRequest.updateMany({
          where: { id, status: DoctorAccessRequestStatus.PENDING, expiresAt: { gt: now } },
          data: {
            status:
              decision === 'approve'
                ? DoctorAccessRequestStatus.APPROVED
                : DoctorAccessRequestStatus.REJECTED,
            reviewedAt: now,
            reviewedByUserId: userId,
          },
        });
        if (changed.count !== 1)
          throw new ConflictException('This access request has already been reviewed.');
        if (decision === 'approve')
          await tx.medicalRecordAccessGrant.create({
            data: {
              patientProfileId: profile.id,
              doctorUserId: accessRequest.doctorUserId,
              shareSessionId: accessRequest.shareSessionId,
              accessRequestId: id,
              grantedByUserId: userId,
              expiresAt: accessRequest.expiresAt,
            },
          });
        await this.audit(tx, {
          patientProfileId: profile.id,
          doctorUserId: accessRequest.doctorUserId,
          actorUserId: userId,
          shareSessionId: accessRequest.shareSessionId,
          eventType:
            decision === 'approve'
              ? MedicalSharingEventType.ACCESS_REQUEST_APPROVED
              : MedicalSharingEventType.ACCESS_REQUEST_REJECTED,
          request,
        });
        return { requestId: id, status: decision === 'approve' ? 'APPROVED' : 'REJECTED' };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if ('expired' in result) throw new ConflictException('This access request has expired.');
    return result;
  }

  async scan(userId: string, token: string, request: AuthenticatedRequest) {
    await this.assertVerifiedDoctor(userId);
    const session = await this.prisma.medicalShareSession.findUnique({
      where: { tokenHash: tokenHash(token) },
      select: {
        id: true,
        patientProfileId: true,
        status: true,
        expiresAt: true,
        maxUses: true,
        useCount: true,
      },
    });
    if (
      !session ||
      session.status !== MedicalShareStatus.ACTIVE ||
      session.expiresAt <= new Date()
    ) {
      await this.audit(this.prisma, {
        doctorUserId: userId,
        actorUserId: userId,
        eventType: MedicalSharingEventType.UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new NotFoundException('This QR sharing code is unavailable or expired.');
    }
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.doctorAccessRequest.findUnique({
            where: {
              shareSessionId_doctorUserId: { shareSessionId: session.id, doctorUserId: userId },
            },
            select: { id: true, status: true, requestedAt: true, expiresAt: true },
          });
          if (existing) return existing;
          const claimed = await tx.medicalShareSession.updateMany({
            where: {
              id: session.id,
              status: MedicalShareStatus.ACTIVE,
              expiresAt: { gt: new Date() },
              useCount: { lt: session.maxUses },
            },
            data: { useCount: { increment: 1 } },
          });
          if (claimed.count !== 1)
            throw new TooManyRequestsException(
              'This sharing code has reached its use limit or expired.',
            );
          const created = await tx.doctorAccessRequest.create({
            data: {
              shareSessionId: session.id,
              patientProfileId: session.patientProfileId,
              doctorUserId: userId,
              expiresAt: session.expiresAt,
            },
            select: { id: true, status: true, requestedAt: true, expiresAt: true },
          });
          await this.audit(tx, {
            patientProfileId: session.patientProfileId,
            doctorUserId: userId,
            actorUserId: userId,
            shareSessionId: session.id,
            eventType: MedicalSharingEventType.DOCTOR_ACCESS_REQUESTED,
            request,
          });
          await this.audit(tx, {
            patientProfileId: session.patientProfileId,
            doctorUserId: userId,
            actorUserId: userId,
            shareSessionId: session.id,
            eventType: MedicalSharingEventType.SHARE_TOKEN_VALIDATED,
            request,
          });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return { request: result };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.doctorAccessRequest.findUnique({
          where: {
            shareSessionId_doctorUserId: { shareSessionId: session.id, doctorUserId: userId },
          },
          select: { id: true, status: true, requestedAt: true, expiresAt: true },
        });
        if (existing) return { request: existing };
      }
      throw error;
    }
  }

  async doctorRequests(userId: string) {
    await this.assertVerifiedDoctor(userId);
    const requests = await this.prisma.doctorAccessRequest.findMany({
      where: { doctorUserId: userId },
      select: {
        id: true,
        status: true,
        requestedAt: true,
        expiresAt: true,
        shareSession: {
          select: {
            permissions: { select: { permissionType: true } },
            documents: {
              select: { medicalDocument: { select: { id: true, title: true, category: true } } },
            },
          },
        },
      },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return { requests };
  }

  async doctorGrants(userId: string) {
    await this.assertVerifiedDoctor(userId);
    const grants = await this.prisma.medicalRecordAccessGrant.findMany({
      where: {
        doctorUserId: userId,
        status: MedicalRecordAccessGrantStatus.ACTIVE,
        expiresAt: { gt: new Date() },
        shareSession: { status: MedicalShareStatus.ACTIVE, expiresAt: { gt: new Date() } },
      },
      select: {
        id: true,
        status: true,
        grantedAt: true,
        expiresAt: true,
        shareSession: {
          select: {
            permissions: { select: { permissionType: true } },
            documents: {
              select: { medicalDocument: { select: { id: true, title: true, category: true } } },
            },
          },
        },
      },
      orderBy: { grantedAt: 'desc' },
      take: 100,
    });
    return { grants };
  }

  async doctorPatientAccess(userId: string, grantId: string, request: AuthenticatedRequest) {
    const { grant, permissions } = await this.activeGrant(userId, grantId, request);
    const profile = await this.prisma.patientProfile.findUnique({
      where: { id: grant.patientProfileId },
      select: {
        ...(permissions.has(MedicalSharePermissionType.PROFILE_BASIC)
          ? { fullName: true, dateOfBirth: true, gender: true }
          : {}),
        ...(permissions.has(MedicalSharePermissionType.BLOOD_GROUP) ? { bloodGroup: true } : {}),
        ...(permissions.has(MedicalSharePermissionType.HEALTH_INFORMATION)
          ? {
              healthInformation: {
                select: {
                  diabetesStatus: true,
                  hypertensionStatus: true,
                  allergies: true,
                  existingMedicalConditions: true,
                  currentMedications: true,
                  additionalNotes: true,
                },
              },
            }
          : {}),
        ...(permissions.has(MedicalSharePermissionType.MEDICAL_DOCUMENTS)
          ? {
              medicalDocuments: {
                where: {
                  id: { in: grant.shareSession.documents.map((item) => item.medicalDocumentId) },
                  deletedAt: null,
                  uploadStatus: 'AVAILABLE',
                },
                select: {
                  id: true,
                  title: true,
                  description: true,
                  category: true,
                  documentDate: true,
                  originalFileName: true,
                  mimeType: true,
                  fileSize: true,
                  scanStatus: true,
                  createdAt: true,
                },
              },
            }
          : {}),
        ...(permissions.has(MedicalSharePermissionType.BLOOD_PRESSURE_READINGS)
          ? {
              bloodPressureReadings: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  systolic: true,
                  diastolic: true,
                  heartRate: true,
                  measuredAt: true,
                  notes: true,
                },
                orderBy: { measuredAt: 'desc' as const },
                take: 100,
              },
            }
          : {}),
        ...(permissions.has(MedicalSharePermissionType.BLOOD_GLUCOSE_READINGS)
          ? {
              bloodGlucoseReadings: {
                where: { deletedAt: null },
                select: {
                  id: true,
                  glucoseValue: true,
                  glucoseUnit: true,
                  measurementType: true,
                  measuredAt: true,
                  notes: true,
                },
                orderBy: { measuredAt: 'desc' as const },
                take: 100,
              },
            }
          : {}),
      },
    });
    if (!profile) throw new NotFoundException('Shared records are unavailable.');
    await this.audit(this.prisma, {
      patientProfileId: grant.patientProfileId,
      doctorUserId: userId,
      actorUserId: userId,
      shareSessionId: grant.shareSessionId,
      eventType: MedicalSharingEventType.SHARED_RECORDS_VIEWED,
      request,
      metadata: { permissionCount: permissions.size },
    });
    return {
      grant: {
        id: grant.id,
        expiresAt: grant.expiresAt,
        grantedAt: grant.grantedAt,
        permissions: [...permissions],
      },
      records: profile,
    };
  }

  async authorizeSharedDocument(
    userId: string,
    grantId: string,
    documentId: string,
    request: AuthenticatedRequest,
  ) {
    const { grant, permissions } = await this.activeGrant(userId, grantId, request);
    if (
      !permissions.has(MedicalSharePermissionType.MEDICAL_DOCUMENTS) ||
      !grant.shareSession.documents.some((document) => document.medicalDocumentId === documentId)
    ) {
      await this.audit(this.prisma, {
        patientProfileId: grant.patientProfileId,
        doctorUserId: userId,
        actorUserId: userId,
        shareSessionId: grant.shareSessionId,
        eventType: MedicalSharingEventType.UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new NotFoundException('Shared document not found.');
    }
    const document = await this.prisma.medicalDocument.findFirst({
      where: {
        id: documentId,
        patientProfileId: grant.patientProfileId,
        deletedAt: null,
        uploadStatus: 'AVAILABLE',
      },
      select: { id: true },
    });
    if (!document) throw new NotFoundException('Shared document not found.');
    return { patientProfileId: grant.patientProfileId, shareSessionId: grant.shareSessionId };
  }

  async recordSharedDocumentDownload(
    userId: string,
    scope: { patientProfileId: string; shareSessionId: string },
    request: AuthenticatedRequest,
  ) {
    await this.audit(this.prisma, {
      patientProfileId: scope.patientProfileId,
      doctorUserId: userId,
      actorUserId: userId,
      shareSessionId: scope.shareSessionId,
      eventType: MedicalSharingEventType.SHARED_DOCUMENT_DOWNLOADED,
      request,
    });
  }

  async revokeGrantByDoctor(userId: string, grantId: string, request: AuthenticatedRequest) {
    await this.assertVerifiedDoctor(userId);
    return this.prisma.$transaction(async (tx) => {
      const grant = await tx.medicalRecordAccessGrant.findFirst({
        where: { id: grantId, doctorUserId: userId },
      });
      if (!grant) throw new NotFoundException('Access grant not found.');
      if (grant.status === MedicalRecordAccessGrantStatus.ACTIVE) {
        const now = new Date();
        await tx.medicalRecordAccessGrant.update({
          where: { id: grantId },
          data: {
            status: MedicalRecordAccessGrantStatus.REVOKED,
            revokedAt: now,
            revokedByUserId: userId,
          },
        });
        await tx.doctorAccessRequest.updateMany({
          where: { id: grant.accessRequestId, status: DoctorAccessRequestStatus.APPROVED },
          data: {
            status: DoctorAccessRequestStatus.REVOKED,
            reviewedAt: now,
            reviewedByUserId: userId,
          },
        });
      }
      await this.audit(tx, {
        patientProfileId: grant.patientProfileId,
        doctorUserId: userId,
        actorUserId: userId,
        shareSessionId: grant.shareSessionId,
        eventType: MedicalSharingEventType.ACCESS_GRANT_REVOKED,
        request,
      });
      return { revoked: true };
    });
  }

  async history(userId: string) {
    const profile = await this.patientProfile(userId);
    const history = await this.prisma.medicalSharingAuditLog.findMany({
      where: { patientProfileId: profile.id },
      select: {
        eventType: true,
        createdAt: true,
        doctor: {
          select: {
            doctorProfile: {
              select: {
                fullName: true,
                professionalRegistrationNo: true,
                registrationAuthority: true,
              },
            },
          },
        },
        shareSession: {
          select: {
            id: true,
            status: true,
            expiresAt: true,
            permissions: { select: { permissionType: true } },
          },
        },
        metadata: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return { history };
  }

  async updateDoctorProfile(userId: string, dto: UpdateDoctorProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, doctorVerificationStatus: true },
    });
    if (user?.role !== 'DOCTOR') throw new ForbiddenException('Doctor account required.');
    if (['APPROVED', 'UNDER_REVIEW', 'SUSPENDED'].includes(user.doctorVerificationStatus ?? ''))
      throw new ForbiddenException('Profile details are locked while approved or under review. Contact an administrator for changes.');
    const doctorProfile = await this.prisma.doctorProfile.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
    return {
      doctorProfile,
      verificationNotice: 'Profile details are self-reported until reviewed by an authorized HealthVault administrator.',
    };
  }

  async getDoctorProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, doctorVerificationStatus: true },
    });
    if (user?.role !== 'DOCTOR') throw new ForbiddenException('Doctor account required.');
    const doctorProfile = await this.prisma.doctorProfile.findUnique({
      where: { userId },
      select: { fullName: true, professionalRegistrationNo: true, registrationAuthority: true, email: true, qualification: true, specialization: true, clinicName: true, clinicAddress: true },
    });
    return {
      doctorProfile,
      doctorVerificationStatus: user.doctorVerificationStatus,
      verificationNotice: 'HealthVault admin review does not constitute independent verification with a medical council or registry.',
    };
  }

  private async patientProfile(userId: string) {
    const profile = await this.prisma.patientProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Patient profile not found.');
    return profile;
  }

  private async assertVerifiedDoctor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        phoneVerified: true,
        doctorVerificationStatus: true,
        accountStatus: true,
        isDevelopmentTestAccount: true,
      },
    });
    if (
      user?.role !== 'DOCTOR' ||
      !user.phoneVerified ||
      user.isDevelopmentTestAccount ||
      user.doctorVerificationStatus !== 'APPROVED' ||
      user.accountStatus !== 'ACTIVE'
    )
      throw new ForbiddenException('An approved doctor account is required.');
  }

  private async activeGrant(userId: string, grantId: string, request: AuthenticatedRequest) {
    await this.assertVerifiedDoctor(userId);
    const now = new Date();
    const grant = await this.prisma.medicalRecordAccessGrant.findFirst({
      where: {
        id: grantId,
        doctorUserId: userId,
        status: MedicalRecordAccessGrantStatus.ACTIVE,
        expiresAt: { gt: now },
        shareSession: { status: MedicalShareStatus.ACTIVE, expiresAt: { gt: now } },
      },
      include: { shareSession: { include: { permissions: true, documents: true } } },
    });
    if (!grant) {
      const expired = await this.prisma.medicalRecordAccessGrant.findFirst({
        where: { id: grantId, doctorUserId: userId, status: MedicalRecordAccessGrantStatus.ACTIVE },
      });
      if (expired && expired.expiresAt <= now) {
        await this.prisma.medicalRecordAccessGrant.update({
          where: { id: grantId },
          data: { status: MedicalRecordAccessGrantStatus.EXPIRED },
        });
        await this.audit(this.prisma, {
          patientProfileId: expired.patientProfileId,
          doctorUserId: userId,
          actorUserId: userId,
          shareSessionId: expired.shareSessionId,
          eventType: MedicalSharingEventType.ACCESS_GRANT_EXPIRED,
          request,
        });
      }
      if (!expired)
        await this.audit(this.prisma, {
          doctorUserId: userId,
          actorUserId: userId,
          eventType: MedicalSharingEventType.UNAUTHORIZED_ACCESS_ATTEMPTED,
          request,
        });
      throw new ForbiddenException('This patient access grant is inactive or expired.');
    }
    return {
      grant,
      permissions: new Set(
        grant.shareSession.permissions.map((permission) => permission.permissionType),
      ),
    };
  }

  private async expireSessions(patientProfileId: string) {
    const expired = await this.prisma.medicalShareSession.findMany({
      where: {
        patientProfileId,
        status: MedicalShareStatus.ACTIVE,
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
    });
    if (!expired.length) return;
    const ids = expired.map((session) => session.id);
    await this.prisma.$transaction([
      this.prisma.medicalShareSession.updateMany({
        where: { id: { in: ids }, status: MedicalShareStatus.ACTIVE },
        data: { status: MedicalShareStatus.EXPIRED },
      }),
      this.prisma.medicalRecordAccessGrant.updateMany({
        where: { shareSessionId: { in: ids }, status: MedicalRecordAccessGrantStatus.ACTIVE },
        data: { status: MedicalRecordAccessGrantStatus.EXPIRED },
      }),
      this.prisma.doctorAccessRequest.updateMany({
        where: { shareSessionId: { in: ids }, status: DoctorAccessRequestStatus.PENDING },
        data: { status: DoctorAccessRequestStatus.EXPIRED },
      }),
      ...expired.map((session) =>
        this.prisma.medicalSharingAuditLog.create({
          data: {
            patientProfileId,
            shareSessionId: session.id,
            eventType: MedicalSharingEventType.SHARE_SESSION_EXPIRED,
          },
        }),
      ),
    ]);
  }

  private async audit(
    client: PrismaService | Prisma.TransactionClient,
    input: {
      patientProfileId?: string;
      doctorUserId?: string;
      actorUserId?: string;
      shareSessionId?: string;
      eventType: MedicalSharingEventType;
      request?: AuthenticatedRequest;
      metadata?: Prisma.InputJsonObject;
    },
  ) {
    await client.medicalSharingAuditLog.create({
      data: {
        ...(input.patientProfileId ? { patientProfileId: input.patientProfileId } : {}),
        ...(input.doctorUserId ? { doctorUserId: input.doctorUserId } : {}),
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.shareSessionId ? { shareSessionId: input.shareSessionId } : {}),
        ...(input.request?.ip ? { ipAddress: input.request.ip.slice(0, 64) } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
        eventType: input.eventType,
      },
    });
  }
}
