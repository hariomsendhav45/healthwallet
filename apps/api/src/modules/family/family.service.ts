import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import {
  FamilyAccessGrantStatus,
  FamilyAuditEventType,
  FamilyInvitationStatus,
  FamilyRelationshipType,
  FamilyGuardianVerificationStatus,
  MedicalSharePermissionType,
  Prisma,
} from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../auth/guards/auth.guard';
import { CreateFamilyConsentDto, CreateFamilyMemberDto, UpdateFamilyMemberDto } from './dto/family.dto';

const familyMemberSelect = {
  id: true,
  fullName: true,
  dateOfBirth: true,
  relationship: true,
  contactNumber: true,
  gender: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FamilyMemberSelect;

const permissionTypes = new Set<MedicalSharePermissionType>([
  MedicalSharePermissionType.PROFILE_BASIC,
  MedicalSharePermissionType.BLOOD_GROUP,
  MedicalSharePermissionType.HEALTH_INFORMATION,
  MedicalSharePermissionType.MEDICAL_DOCUMENTS,
  MedicalSharePermissionType.BLOOD_PRESSURE_READINGS,
  MedicalSharePermissionType.BLOOD_GLUCOSE_READINGS,
]);

@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService) {}

  async createMember(userId: string, dto: CreateFamilyMemberDto, request: AuthenticatedRequest) {
    this.validateDob(dto.dateOfBirth);
    const profile = await this.getPatientProfile(userId);
    const familyMember = await this.prisma.$transaction(async (tx) => {
      const result = await tx.familyMember.create({
        data: {
          ownerPatientProfileId: profile.id,
          ownerUserId: userId,
          fullName: dto.fullName,
          relationship: dto.relationship as FamilyRelationshipType,
          ...(dto.dateOfBirth ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
          ...(dto.contactNumber ? { contactNumber: dto.contactNumber } : {}),
          ...(dto.gender ? { gender: dto.gender } : {}),
        },
        select: familyMemberSelect,
      });
      await this.audit(tx, {
        familyMemberId: result.id,
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_MEMBER_CREATED,
        request,
      });
      return result;
    });
    return { familyMember: { ...familyMember, accountLinked: false }, accessStatus: 'NO_ACCESS' as const };
  }

  async listMembers(userId: string) {
    const profile = await this.getPatientProfile(userId);
    const members = await this.prisma.familyMember.findMany({
      where: { ownerPatientProfileId: profile.id },
      orderBy: { createdAt: 'desc' },
      select: {
        ...familyMemberSelect,
        claimedByUserId: true,
        invitations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, expiresAt: true, createdAt: true },
        },
        grants: {
          where: { status: FamilyAccessGrantStatus.ACTIVE, expiresAt: { gt: new Date() } },
          orderBy: { grantedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            expiresAt: true,
            grantedAt: true,
            permissions: { select: { permissionType: true } },
          },
        },
        guardianRelationship: { select: { verificationStatus: true } },
      },
    });
    return {
      familyMembers: members.map(({ invitations, grants, guardianRelationship, claimedByUserId, ...member }) => ({
        ...member,
        accountLinked: Boolean(claimedByUserId),
        invitation: invitations[0] ?? null,
        accessGrant: grants[0] ?? null,
        accessStatus: guardianRelationship
          ? 'GUARDIAN_UNVERIFIED_NO_ACCESS'
          : grants.length
            ? 'ACTIVE'
            : claimedByUserId
              ? 'CONNECTED_NO_ACCESS'
              : invitations[0]?.status ?? 'NOT_INVITED',
      })),
    };
  }

  async getMember(userId: string, id: string, request?: AuthenticatedRequest) {
    const familyMember = await this.prisma.familyMember.findFirst({
      where: { id, ownerUserId: userId },
      select: {
        ...familyMemberSelect,
        claimedByUserId: true,
        invitations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, expiresAt: true, createdAt: true },
        },
        grants: {
          where: { status: FamilyAccessGrantStatus.ACTIVE, expiresAt: { gt: new Date() } },
          orderBy: { grantedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            expiresAt: true,
            permissions: { select: { permissionType: true } },
            documents: { select: { medicalDocumentId: true } },
          },
        },
        guardianRelationship: { select: { verificationStatus: true } },
      },
    });
    if (!familyMember) {
      await this.audit(this.prisma, {
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        ...(request ? { request } : {}),
      });
      throw new NotFoundException('Family member not found.');
    }
    const { invitations, grants, guardianRelationship, claimedByUserId, ...member } = familyMember;
    return {
      familyMember: { ...member, accountLinked: Boolean(claimedByUserId), guardianRelationship },
      invitation: invitations[0] ?? null,
      accessGrant: grants[0] ?? null,
      accessStatus: guardianRelationship
        ? 'GUARDIAN_UNVERIFIED_NO_ACCESS'
        : grants.length
          ? 'ACTIVE'
          : claimedByUserId
            ? 'CONNECTED_NO_ACCESS'
            : invitations[0]?.status ?? 'NOT_INVITED',
    };
  }

  async updateMember(
    userId: string,
    id: string,
    dto: UpdateFamilyMemberDto,
    request: AuthenticatedRequest,
  ) {
    this.validateDob(dto.dateOfBirth);
    const member = await this.prisma.familyMember.findFirst({
      where: { id, ownerUserId: userId },
      select: { id: true, claimedByUserId: true, relationship: true },
    });
    if (!member) {
      await this.audit(this.prisma, {
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new NotFoundException('Family member not found.');
    }
    if (dto.contactNumber && member.claimedByUserId) {
      const account = await this.prisma.user.findUnique({
        where: { id: member.claimedByUserId },
        select: { phoneNumber: true },
      });
      if (account?.phoneNumber !== dto.contactNumber)
        throw new ConflictException('A linked member’s verified number cannot be changed here.');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.familyMember.update({
        where: { id },
        data: {
          ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
          ...(dto.relationship !== undefined
            ? { relationship: dto.relationship as FamilyRelationshipType }
            : {}),
          ...(dto.dateOfBirth !== undefined
            ? { dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null }
            : {}),
          ...(dto.contactNumber !== undefined ? { contactNumber: dto.contactNumber } : {}),
          ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
        },
        select: familyMemberSelect,
      });
      if (dto.relationship === FamilyRelationshipType.CHILD) {
        const activeGrants = await tx.familyAccessGrant.findMany({
          where: { familyMemberId: id, status: FamilyAccessGrantStatus.ACTIVE },
          select: { id: true, recipientUserId: true },
        });
        await tx.familyAccessGrant.updateMany({
          where: { familyMemberId: id, status: FamilyAccessGrantStatus.ACTIVE },
          data: { status: FamilyAccessGrantStatus.REVOKED, revokedAt: new Date() },
        });
        for (const grant of activeGrants) {
          await this.audit(tx, {
            familyMemberId: id,
            actorUserId: userId,
            targetUserId: grant.recipientUserId,
            grantId: grant.id,
            eventType: FamilyAuditEventType.FAMILY_ACCESS_REVOKED,
            request,
          });
        }
      }
      await this.audit(tx, {
        familyMemberId: id,
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_MEMBER_UPDATED,
        request,
      });
      return result;
    });
    return { familyMember: updated };
  }

  async removeMember(userId: string, id: string, request: AuthenticatedRequest) {
    await this.withOwnedMember(userId, id, request);
    await this.prisma.$transaction(async (tx) => {
      const activeGrants = await tx.familyAccessGrant.findMany({
        where: { familyMemberId: id, status: FamilyAccessGrantStatus.ACTIVE },
        select: { id: true, recipientUserId: true },
      });
      await tx.familyAccessGrant.updateMany({
        where: { familyMemberId: id, status: FamilyAccessGrantStatus.ACTIVE },
        data: { status: FamilyAccessGrantStatus.REVOKED, revokedAt: new Date() },
      });
      await tx.familyInvitation.updateMany({
        where: { familyMemberId: id, status: FamilyInvitationStatus.PENDING },
        data: { status: FamilyInvitationStatus.REVOKED },
      });
      for (const grant of activeGrants) {
        await this.audit(tx, {
          familyMemberId: id,
          actorUserId: userId,
          targetUserId: grant.recipientUserId,
          grantId: grant.id,
          eventType: FamilyAuditEventType.FAMILY_ACCESS_REVOKED,
          request,
        });
      }
      await this.audit(tx, {
        familyMemberId: id,
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_MEMBER_REMOVED,
        request,
      });
      await tx.familyMember.delete({ where: { id } });
    });
    return { removed: true };
  }

  async createInvitation(userId: string, id: string, request: AuthenticatedRequest) {
    const member = await this.withOwnedMember(userId, id, request);
    if (!member.contactNumber)
      throw new BadRequestException('Add the family member’s mobile number before inviting them.');
    if (member.claimedByUserId)
      throw new ConflictException('This family member has already claimed the relationship.');
    const sender = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { phoneNumber: true },
    });
    if (sender?.phoneNumber === member.contactNumber)
      throw new BadRequestException('You cannot invite your own account as a family member.');

    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const prior = await this.prisma.familyInvitation.count({
      where: { familyMemberId: id },
    });
    const invitation = await this.prisma.$transaction(async (tx) => {
      const pending = await tx.familyInvitation.findMany({
        where: { familyMemberId: id, status: FamilyInvitationStatus.PENDING },
        select: { id: true },
      });
      await tx.familyInvitation.updateMany({
        where: { familyMemberId: id, status: FamilyInvitationStatus.PENDING },
        data: { status: FamilyInvitationStatus.REVOKED },
      });
      for (const oldInvitation of pending) {
        if (!oldInvitation.id) continue;
        await this.audit(tx, {
          familyMemberId: id,
          actorUserId: userId,
          eventType: FamilyAuditEventType.FAMILY_INVITATION_REVOKED,
          request,
        });
      }
      const result = await tx.familyInvitation.create({
        data: {
          familyMemberId: id,
          senderUserId: userId,
          targetPhoneNumber: member.contactNumber!,
          tokenHash,
          expiresAt,
        },
        select: { id: true, status: true, expiresAt: true, createdAt: true },
      });
      await this.audit(tx, {
        familyMemberId: id,
        actorUserId: userId,
        eventType: prior ? FamilyAuditEventType.FAMILY_INVITATION_RESENT : FamilyAuditEventType.FAMILY_INVITATION_CREATED,
        request,
      });
      return result;
    });
    return {
      invitation,
      token,
      delivery: 'COPY_LINK',
      targetPhoneNumber: this.maskPhone(member.contactNumber),
    };
  }

  async listInvitations(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phoneNumber: true, phoneVerified: true },
    });
    const now = new Date();
    const expired = await this.prisma.familyInvitation.findMany({
      where: {
        status: FamilyInvitationStatus.PENDING,
        expiresAt: { lte: now },
        OR: [{ senderUserId: userId }, { targetPhoneNumber: user.phoneNumber }],
      },
      select: { id: true, familyMemberId: true },
      take: 100,
    });
    if (expired.length) {
      await this.prisma.$transaction(async (tx) => {
        for (const invitation of expired) {
          const changed = await tx.familyInvitation.updateMany({
            where: { id: invitation.id, status: FamilyInvitationStatus.PENDING },
            data: { status: FamilyInvitationStatus.EXPIRED },
          });
          if (changed.count === 1) {
            await this.audit(tx, {
              familyMemberId: invitation.familyMemberId,
              targetUserId: userId,
              eventType: FamilyAuditEventType.FAMILY_INVITATION_EXPIRED,
            });
          }
        }
      });
    }
    const [sent, received] = await Promise.all([
      this.prisma.familyInvitation.findMany({
        where: { senderUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          status: true,
          targetPhoneNumber: true,
          expiresAt: true,
          createdAt: true,
          acceptedAt: true,
          familyMember: { select: { id: true, fullName: true, relationship: true } },
        },
      }),
      user.phoneVerified
        ? this.prisma.familyInvitation.findMany({
            where: {
              targetPhoneNumber: user.phoneNumber,
              status: FamilyInvitationStatus.PENDING,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: {
              id: true,
              status: true,
              expiresAt: true,
              createdAt: true,
              familyMember: {
                select: {
                  fullName: true,
                  relationship: true,
                  ownerPatientProfile: { select: { fullName: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);
    const memberLinks = await this.prisma.familyMember.findMany({
      where: { claimedByUserId: userId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        relationship: true,
        guardianRelationship: { select: { verificationStatus: true } },
        ownerPatientProfile: { select: { fullName: true } },
        grants: {
          where: { status: FamilyAccessGrantStatus.ACTIVE, expiresAt: { gt: new Date() } },
          orderBy: { grantedAt: 'desc' },
          take: 1,
          select: {
            id: true,
            expiresAt: true,
            permissions: { select: { permissionType: true } },
            documents: { select: { medicalDocumentId: true } },
          },
        },
      },
    });
    return {
      sentInvitations: sent.map((item) => ({
        ...item,
        targetPhoneNumber: this.maskPhone(item.targetPhoneNumber),
      })),
      receivedInvitations: received,
      familyLinks: memberLinks.map(({ grants, guardianRelationship, ...link }) => ({
        ...link,
        accessGrant: grants[0] ?? null,
        accessStatus: guardianRelationship
          ? 'GUARDIAN_UNVERIFIED_NO_ACCESS'
          : grants.length
            ? 'ACTIVE'
            : 'NO_ACCESS',
      })),
    };
  }

  async acceptInvitation(userId: string, token: string, request: AuthenticatedRequest) {
    return this.claimInvitation(userId, token, true, request);
  }

  async rejectInvitation(userId: string, token: string, request: AuthenticatedRequest) {
    return this.claimInvitation(userId, token, false, request);
  }

  async grantConsent(
    userId: string,
    id: string,
    dto: CreateFamilyConsentDto,
    request: AuthenticatedRequest,
  ) {
    const member = await this.prisma.familyMember.findFirst({
      where: { id, claimedByUserId: userId },
      include: {
        ownerPatientProfile: { select: { userId: true } },
        guardianRelationship: { select: { verificationStatus: true } },
      },
    });
    if (!member) throw new NotFoundException('Accepted family relationship not found.');
    if (member.relationship === FamilyRelationshipType.CHILD || member.guardianRelationship) {
      await this.audit(this.prisma, {
        familyMemberId: id,
        actorUserId: userId,
        targetUserId: member.ownerUserId,
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new ForbiddenException('Guardian authority is unverified; family record access is disabled.');
    }
    const invalidPermissions = dto.permissionTypes.some((permission) => !permissionTypes.has(permission));
    if (invalidPermissions) throw new BadRequestException('Choose supported family record permissions.');
    const permitsDocs = dto.permissionTypes.includes(MedicalSharePermissionType.MEDICAL_DOCUMENTS);
    const documentIds = [...new Set(dto.medicalDocumentIds ?? [])];
    if (permitsDocs && documentIds.length === 0)
      throw new BadRequestException('Select at least one medical document.');
    if (!permitsDocs && documentIds.length > 0)
      throw new BadRequestException('Medical documents require explicit document permission.');
    const profile = await this.getPatientProfile(userId);
    if (profile.id === member.ownerPatientProfileId)
      throw new BadRequestException('An account cannot grant access to itself through a family link.');
    if (documentIds.length) {
      const ownedCount = await this.prisma.medicalDocument.count({
        where: {
          id: { in: documentIds },
          patientProfileId: profile.id,
          deletedAt: null,
          uploadStatus: 'AVAILABLE',
        },
      });
      if (ownedCount !== documentIds.length)
        throw new BadRequestException('One or more selected documents are unavailable.');
    }
    const expiresAt = new Date(Date.now() + dto.durationDays * 24 * 60 * 60 * 1000);
    const grant = await this.prisma.$transaction(async (tx) => {
      await tx.familyAccessGrant.updateMany({
        where: { familyMemberId: id, status: FamilyAccessGrantStatus.ACTIVE },
        data: { status: FamilyAccessGrantStatus.REVOKED, revokedAt: new Date() },
      });
      const created = await tx.familyAccessGrant.create({
        data: {
          familyMemberId: id,
          patientProfileId: profile.id,
          recipientUserId: member.ownerUserId,
          grantedByUserId: userId,
          expiresAt,
          permissions: { create: dto.permissionTypes.map((permissionType) => ({ permissionType })) },
          ...(documentIds.length
            ? { documents: { create: documentIds.map((medicalDocumentId) => ({ medicalDocumentId })) } }
            : {}),
        },
        select: {
          id: true,
          expiresAt: true,
          permissions: { select: { permissionType: true } },
          documents: { select: { medicalDocumentId: true } },
        },
      });
      await this.audit(tx, {
        familyMemberId: id,
        actorUserId: userId,
        targetUserId: member.ownerUserId,
        grantId: created.id,
        eventType: FamilyAuditEventType.FAMILY_ACCESS_GRANTED,
        request,
      });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { accessGrant: grant };
  }

  async revokeConsent(userId: string, id: string, request: AuthenticatedRequest) {
    const member = await this.prisma.familyMember.findFirst({
      where: { id, claimedByUserId: userId },
      select: { id: true, ownerUserId: true },
    });
    if (!member) throw new NotFoundException('Accepted family relationship not found.');
    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      const active = await tx.familyAccessGrant.findFirst({
        where: { familyMemberId: id, grantedByUserId: userId, status: FamilyAccessGrantStatus.ACTIVE },
        select: { id: true },
      });
      if (!active) return false;
      await tx.familyAccessGrant.update({
        where: { id: active.id },
        data: { status: FamilyAccessGrantStatus.REVOKED, revokedAt: now },
      });
      await this.audit(tx, {
        familyMemberId: id,
        actorUserId: userId,
        targetUserId: member.ownerUserId,
        grantId: active.id,
        eventType: FamilyAuditEventType.FAMILY_ACCESS_REVOKED,
        request,
      });
      return true;
    });
    return { revoked: result };
  }

  async familyRecords(userId: string, id: string, request: AuthenticatedRequest) {
    const { member, grant, permissions } = await this.activeGrantForRecipient(userId, id, request);
    const patientUserId = member.claimedByUserId;
    if (!patientUserId) throw new NotFoundException('Family records are unavailable.');
    const select: Prisma.PatientProfileSelect = {
      ...(permissions.has(MedicalSharePermissionType.PROFILE_BASIC)
        ? { fullName: true, dateOfBirth: true, gender: true }
        : {}),
      ...(permissions.has(MedicalSharePermissionType.BLOOD_GROUP) ? { bloodGroup: true } : {}),
      ...(permissions.has(MedicalSharePermissionType.HEALTH_INFORMATION)
        ? { healthInformation: { select: { diabetesStatus: true, hypertensionStatus: true, allergies: true, existingMedicalConditions: true, currentMedications: true, additionalNotes: true } } }
        : {}),
      ...(permissions.has(MedicalSharePermissionType.MEDICAL_DOCUMENTS)
        ? {
            medicalDocuments: {
              where: {
                id: { in: grant.documents.map(({ medicalDocumentId }) => medicalDocumentId) },
                deletedAt: null,
                uploadStatus: 'AVAILABLE',
              },
              select: { id: true, title: true, category: true, documentDate: true, mimeType: true, fileSize: true },
            },
          }
        : {}),
      ...(permissions.has(MedicalSharePermissionType.BLOOD_PRESSURE_READINGS)
        ? { bloodPressureReadings: { where: { deletedAt: null }, select: { id: true, systolic: true, diastolic: true, heartRate: true, measuredAt: true, notes: true }, orderBy: { measuredAt: 'desc' as const }, take: 100 } }
        : {}),
      ...(permissions.has(MedicalSharePermissionType.BLOOD_GLUCOSE_READINGS)
        ? { bloodGlucoseReadings: { where: { deletedAt: null }, select: { id: true, glucoseValue: true, glucoseUnit: true, measurementType: true, measuredAt: true, notes: true }, orderBy: { measuredAt: 'desc' as const }, take: 100 } }
        : {}),
    };
    const records = await this.prisma.patientProfile.findFirst({
      where: { id: grant.patientProfileId, userId: patientUserId },
      select,
    });
    if (!records) throw new NotFoundException('Family records are unavailable.');
    await this.audit(this.prisma, {
      familyMemberId: id,
      actorUserId: userId,
      ...(member.claimedByUserId ? { targetUserId: member.claimedByUserId } : {}),
      grantId: grant.id,
      eventType: FamilyAuditEventType.FAMILY_RECORDS_VIEWED,
      request,
    });
    return { accessGrant: { expiresAt: grant.expiresAt, permissions: [...permissions] }, records };
  }

  async familyDocument(userId: string, id: string, documentId: string, request: AuthenticatedRequest) {
    const { member, grant, permissions } = await this.activeGrantForRecipient(userId, id, request);
    if (
      !permissions.has(MedicalSharePermissionType.MEDICAL_DOCUMENTS) ||
      !grant.documents.some((document) => document.medicalDocumentId === documentId)
    ) {
      await this.audit(this.prisma, {
        familyMemberId: id,
        actorUserId: userId,
        ...(member.claimedByUserId ? { targetUserId: member.claimedByUserId } : {}),
        grantId: grant.id,
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new NotFoundException('Family document not found.');
    }
    await this.audit(this.prisma, {
      familyMemberId: id,
      actorUserId: userId,
      ...(member.claimedByUserId ? { targetUserId: member.claimedByUserId } : {}),
      grantId: grant.id,
      eventType: FamilyAuditEventType.FAMILY_DOCUMENT_DOWNLOADED,
      request,
    });
    const document = await this.prisma.medicalDocument.findFirst({
      where: {
        id: documentId,
        patientProfileId: grant.patientProfileId,
        deletedAt: null,
        uploadStatus: 'AVAILABLE',
      },
      select: { id: true, originalFileName: true, mimeType: true, fileSize: true },
    });
    if (!document) throw new NotFoundException('Family document not found.');
    return { patientProfileId: grant.patientProfileId, document };
  }

  async sharedContent(patientProfileId: string, documentId: string) {
    const document = await this.prisma.medicalDocument.findFirst({
      where: { id: documentId, patientProfileId, deletedAt: null, uploadStatus: 'AVAILABLE' },
      select: { id: true, originalFileName: true, mimeType: true, fileSize: true, storageKey: true, fileChecksum: true },
    });
    if (!document) throw new NotFoundException('Family document not found.');
    return document;
  }

  private async claimInvitation(
    userId: string,
    token: string,
    accept: boolean,
    request: AuthenticatedRequest,
  ) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invite = await this.prisma.familyInvitation.findUnique({
      where: { tokenHash },
      include: {
        familyMember: {
          include: { ownerPatientProfile: { select: { fullName: true } } },
        },
      },
    });
    const now = new Date();
    if (!invite || invite.status !== FamilyInvitationStatus.PENDING) {
      await this.audit(this.prisma, {
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new BadRequestException('This invitation is invalid, expired, or already used.');
    }
    if (invite.expiresAt <= now) {
      await this.prisma.$transaction(async (tx) => {
        await tx.familyInvitation.updateMany({
          where: { id: invite.id, status: FamilyInvitationStatus.PENDING },
          data: { status: FamilyInvitationStatus.EXPIRED },
        });
        await this.audit(tx, {
          familyMemberId: invite.familyMemberId,
          actorUserId: userId,
          eventType: FamilyAuditEventType.FAMILY_INVITATION_EXPIRED,
          request,
        });
      });
      throw new BadRequestException('This invitation is invalid, expired, or already used.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, phoneNumber: true, phoneVerified: true },
    });
    if (
      !user || user.role !== 'PATIENT' || !user.phoneVerified ||
      user.phoneNumber !== invite.targetPhoneNumber || user.id === invite.senderUserId
    ) {
      await this.audit(this.prisma, {
        familyMemberId: invite.familyMemberId,
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new ForbiddenException('Sign in with the verified mobile number this invitation was sent to.');
    }
    const data = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.familyInvitation.updateMany({
        where: { id: invite.id, tokenHash, status: FamilyInvitationStatus.PENDING, expiresAt: { gt: now } },
        data: accept
          ? { status: FamilyInvitationStatus.ACCEPTED, acceptedAt: now, acceptedByUserId: userId }
          : { status: FamilyInvitationStatus.REJECTED, rejectedAt: now },
      });
      if (claimed.count !== 1) throw new ConflictException('This invitation has already been used.');
      if (accept) {
        const linked = await tx.familyMember.updateMany({
          where: { id: invite.familyMemberId, claimedByUserId: null },
          data: { claimedByUserId: userId },
        });
        if (linked.count !== 1) throw new ConflictException('This family relationship is already claimed.');
      }
      await this.audit(tx, {
        familyMemberId: invite.familyMemberId,
        actorUserId: userId,
        targetUserId: invite.senderUserId,
        eventType: accept
          ? FamilyAuditEventType.FAMILY_INVITATION_ACCEPTED
          : FamilyAuditEventType.FAMILY_INVITATION_REJECTED,
        request,
      });
      if (accept && invite.familyMember.relationship === FamilyRelationshipType.CHILD) {
        const represented = await tx.patientProfile.upsert({
          where: { userId },
          create: { userId },
          update: {},
          select: { id: true },
        });
        await tx.familyGuardianRelationship.create({
          data: {
            familyMemberId: invite.familyMemberId,
            guardianUserId: invite.senderUserId,
            representedPatientProfileId: represented.id,
            verificationStatus: FamilyGuardianVerificationStatus.UNVERIFIED,
          },
        });
        await this.audit(tx, {
          familyMemberId: invite.familyMemberId,
          actorUserId: invite.senderUserId,
          targetUserId: userId,
          eventType: FamilyAuditEventType.FAMILY_GUARDIAN_CLAIM_CREATED,
          request,
        });
      }
      return { id: invite.familyMemberId, status: accept ? 'ACCEPTED' : 'REJECTED' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return {
      invitation: data,
      familyMember: accept
        ? {
            fullName: invite.familyMember.fullName,
            relationship: invite.familyMember.relationship,
            ownerName: invite.familyMember.ownerPatientProfile.fullName,
          }
        : undefined,
      accessStatus: 'NO_ACCESS' as const,
      guardianVerificationStatus:
        accept && invite.familyMember.relationship === FamilyRelationshipType.CHILD ? 'UNVERIFIED' : null,
    };
  }

  private async activeGrantForRecipient(userId: string, id: string, request: AuthenticatedRequest) {
    const member = await this.prisma.familyMember.findFirst({
      where: { id, ownerUserId: userId, claimedByUserId: { not: null } },
      select: { id: true, relationship: true, claimedByUserId: true, ownerPatientProfileId: true },
    });
    if (!member) throw new NotFoundException('Family records are unavailable.');
    const grant = await this.prisma.familyAccessGrant.findFirst({
      where: {
        familyMemberId: id,
        recipientUserId: userId,
        grantedByUserId: member.claimedByUserId!,
        patientProfile: { userId: member.claimedByUserId! },
        status: FamilyAccessGrantStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      include: {
        permissions: { select: { permissionType: true } },
        documents: { select: { medicalDocumentId: true } },
      },
    });
    if (!grant || member.relationship === FamilyRelationshipType.CHILD) {
      await this.audit(this.prisma, {
        familyMemberId: id,
        actorUserId: userId,
        ...(member.claimedByUserId ? { targetUserId: member.claimedByUserId } : {}),
        ...(grant?.id ? { grantId: grant.id } : {}),
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new ForbiddenException('This family member has not granted record access.');
    }
    return {
      member,
      grant,
      permissions: new Set(grant.permissions.map(({ permissionType }) => permissionType)),
    };
  }

  private async getPatientProfile(userId: string) {
    const profile = await this.prisma.patientProfile.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    return profile;
  }

  private async withOwnedMember(userId: string, id: string, request: AuthenticatedRequest) {
    const member = await this.prisma.familyMember.findFirst({
      where: { id, ownerUserId: userId },
      select: { id: true, contactNumber: true, claimedByUserId: true, relationship: true },
    });
    if (!member) {
      await this.audit(this.prisma, {
        actorUserId: userId,
        eventType: FamilyAuditEventType.FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED,
        request,
      });
      throw new NotFoundException('Family member not found.');
    }
    return member;
  }

  private validateDob(value?: string | null) {
    if (value) {
      const date = new Date(value);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (Number.isNaN(date.getTime()) || date > today)
        throw new BadRequestException('Enter a valid date of birth.');
    }
  }

  private maskPhone(phone: string) {
    return `${phone.slice(0, 3)}••••${phone.slice(-2)}`;
  }

  private async audit(
    client: PrismaService | Prisma.TransactionClient,
    input: {
      familyMemberId?: string;
      actorUserId?: string;
      targetUserId?: string;
      grantId?: string;
      eventType: FamilyAuditEventType;
      request?: AuthenticatedRequest;
    },
  ) {
    await client.familyAuditLog.create({
      data: {
        ...(input.familyMemberId ? { familyMemberId: input.familyMemberId } : {}),
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
        ...(input.grantId ? { grantId: input.grantId } : {}),
        ...(input.request?.ip ? { ipAddress: input.request.ip.slice(0, 64) } : {}),
        eventType: input.eventType,
      },
    });
  }
}
