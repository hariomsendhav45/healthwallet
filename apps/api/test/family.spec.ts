import { createHash } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FamilyInvitationStatus, FamilyRelationshipType } from '../src/generated/prisma';
import { PrismaService } from '../src/database/prisma.service';
import { AuthenticatedRequest } from '../src/modules/auth/guards/auth.guard';
import { CreateFamilyMemberDto } from '../src/modules/family/dto/family.dto';
import { FamilyService } from '../src/modules/family/family.service';

const owner = '11111111-1111-4111-8111-111111111111';
const memberUser = '22222222-2222-4222-8222-222222222222';
const ownerProfile = '33333333-3333-4333-8333-333333333333';
const memberProfile = '44444444-4444-4444-8444-444444444444';
const memberId = '55555555-5555-4555-8555-555555555555';
const grantId = '66666666-6666-4666-8666-666666666666';
const request = { ip: '127.0.0.1' } as AuthenticatedRequest;
const makeService = (prisma: object) => new FamilyService(prisma as PrismaService);
const transaction = (tx: object) => jest.fn((callback: (value: object) => unknown) => callback(tx));

describe('family DTO validation', () => {
  it('accepts the supported relationship fields and rejects malformed contact numbers', async () => {
    const valid = plainToInstance(CreateFamilyMemberDto, {
      fullName: 'Sam Member',
      relationship: 'SIBLING',
      contactNumber: '+919876543210',
    });
    expect(await validate(valid)).toHaveLength(0);
    const invalid = plainToInstance(CreateFamilyMemberDto, {
      fullName: ' ',
      relationship: 'LEGAL_GUARDIAN',
      contactNumber: '9876543210',
    });
    expect((await validate(invalid)).length).toBeGreaterThan(0);
  });
});

describe('FamilyService ownership, invitation and consent controls', () => {
  it('creates an owner-scoped relationship with no medical access', async () => {
    const tx = {
      familyMember: { create: jest.fn().mockResolvedValue({ id: memberId, fullName: 'Sam', claimedByUserId: null }) },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      patientProfile: { upsert: jest.fn().mockResolvedValue({ id: ownerProfile }) },
      $transaction: transaction(tx),
    };
    const result = await makeService(prisma).createMember(owner, {
      fullName: 'Sam', relationship: 'SIBLING' as never,
    }, request);
    expect(tx.familyMember.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerPatientProfileId: ownerProfile, ownerUserId: owner }),
    }));
    expect(result.accessStatus).toBe('NO_ACCESS');
    expect(result.familyMember.accountLinked).toBe(false);
  });

  it('returns not found for a family-member ID owned by another patient', async () => {
    const prisma = {
      familyMember: { findFirst: jest.fn().mockResolvedValue(null) },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await expect(makeService(prisma).getMember(memberUser, memberId, request)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.familyMember.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: memberId, ownerUserId: memberUser },
    }));
  });

  it('stores only the invitation token hash and creates a bounded, one-time claim secret', async () => {
    const tx = {
      familyInvitation: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }: { data: object }) => ({ id: 'invite-id', ...data })),
      },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      familyMember: { findFirst: jest.fn().mockResolvedValue({ id: memberId, contactNumber: '+919876543210', claimedByUserId: null }) },
      user: { findUnique: jest.fn().mockResolvedValue({ phoneNumber: '+919999999999' }) },
      familyInvitation: { count: jest.fn().mockResolvedValue(0) },
      $transaction: transaction(tx),
    };
    const result = await makeService(prisma).createInvitation(owner, memberId, request);
    const data = tx.familyInvitation.create.mock.calls[0][0].data;
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(data.tokenHash).toBe(createHash('sha256').update(result.token).digest('hex'));
    expect(data.tokenHash).not.toBe(result.token);
    expect(result.invitation.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result).toHaveProperty('delivery', 'COPY_LINK');
  });

  it('revokes the previous pending invitation when resending', async () => {
    const tx = {
      familyInvitation: {
        findMany: jest.fn().mockResolvedValue([{ id: 'old-invitation' }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'new-invitation', status: 'PENDING', expiresAt: new Date(Date.now() + 1000), createdAt: new Date() }),
      },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      familyMember: { findFirst: jest.fn().mockResolvedValue({ id: memberId, contactNumber: '+919876543210', claimedByUserId: null }) },
      user: { findUnique: jest.fn().mockResolvedValue({ phoneNumber: '+919999999999' }) },
      familyInvitation: { count: jest.fn().mockResolvedValue(1) },
      $transaction: transaction(tx),
    };
    const result = await makeService(prisma).createInvitation(owner, memberId, request);
    expect(result.invitation.id).toBe('new-invitation');
    expect(tx.familyInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { familyMemberId: memberId, status: FamilyInvitationStatus.PENDING },
      data: { status: FamilyInvitationStatus.REVOKED },
    }));
    expect(tx.familyAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'FAMILY_INVITATION_REVOKED' }),
    }));
  });

  it('accepts a valid invitation once without creating a family access grant', async () => {
    const token = 'D'.repeat(43);
    const invitation = {
      id: 'invite-id', familyMemberId: memberId, senderUserId: owner,
      targetPhoneNumber: '+919876543210', tokenHash: createHash('sha256').update(token).digest('hex'),
      status: FamilyInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 60_000),
      familyMember: { relationship: FamilyRelationshipType.SPOUSE, fullName: 'Sam', ownerPatientProfile: { fullName: 'Alex' } },
    };
    const tx = {
      familyInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      familyMember: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      familyAccessGrant: { create: jest.fn() },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      familyInvitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: memberUser, role: 'PATIENT', phoneNumber: invitation.targetPhoneNumber, phoneVerified: true }) },
      $transaction: transaction(tx),
    };
    const result = await makeService(prisma).acceptInvitation(memberUser, token, request);
    expect(result.invitation.status).toBe('ACCEPTED');
    expect(result.accessStatus).toBe('NO_ACCESS');
    expect(tx.familyMember.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: memberId, claimedByUserId: null },
      data: { claimedByUserId: memberUser },
    }));
    expect(tx.familyAccessGrant.create).not.toHaveBeenCalled();
  });

  it('rejects an invitation without linking the account or granting access', async () => {
    const token = 'E'.repeat(43);
    const invitation = {
      id: 'invite-id', familyMemberId: memberId, senderUserId: owner,
      targetPhoneNumber: '+919876543210', tokenHash: createHash('sha256').update(token).digest('hex'),
      status: FamilyInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 60_000),
      familyMember: { relationship: FamilyRelationshipType.SPOUSE, fullName: 'Sam', ownerPatientProfile: { fullName: 'Alex' } },
    };
    const tx = {
      familyInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      familyMember: { updateMany: jest.fn() },
      familyAccessGrant: { create: jest.fn() },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      familyInvitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: memberUser, role: 'PATIENT', phoneNumber: invitation.targetPhoneNumber, phoneVerified: true }) },
      $transaction: transaction(tx),
    };
    const result = await makeService(prisma).rejectInvitation(memberUser, token, request);
    expect(result.invitation.status).toBe('REJECTED');
    expect(tx.familyMember.updateMany).not.toHaveBeenCalled();
    expect(tx.familyAccessGrant.create).not.toHaveBeenCalled();
  });

  it('requires the matching verified phone and patient account before accepting an invitation', async () => {
    const token = 'A'.repeat(43);
    const invitation = {
      id: 'invite-id',
      familyMemberId: memberId,
      senderUserId: owner,
      targetPhoneNumber: '+919876543210',
      tokenHash: createHash('sha256').update(token).digest('hex'),
      status: FamilyInvitationStatus.PENDING,
      expiresAt: new Date(Date.now() + 60_000),
      familyMember: { relationship: FamilyRelationshipType.SPOUSE, fullName: 'Sam', ownerPatientProfile: { fullName: 'Alex' } },
    };
    const prisma = {
      familyInvitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: memberUser, role: 'PATIENT', phoneNumber: '+919800000000', phoneVerified: true }) },
      $transaction: jest.fn(),
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await expect(makeService(prisma).acceptInvitation(memberUser, token, request)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('uses a conditional status update so a claim token cannot be accepted twice', async () => {
    const token = 'B'.repeat(43);
    const invitation = {
      id: 'invite-id', familyMemberId: memberId, senderUserId: owner,
      targetPhoneNumber: '+919876543210', tokenHash: createHash('sha256').update(token).digest('hex'),
      status: FamilyInvitationStatus.PENDING, expiresAt: new Date(Date.now() + 60_000),
      familyMember: { relationship: FamilyRelationshipType.SPOUSE, fullName: 'Sam', ownerPatientProfile: { fullName: 'Alex' } },
    };
    const tx = {
      familyInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      familyAuditLog: { create: jest.fn() },
    };
    const prisma = {
      familyInvitation: { findUnique: jest.fn().mockResolvedValue(invitation) },
      user: { findUnique: jest.fn().mockResolvedValue({ id: memberUser, role: 'PATIENT', phoneNumber: invitation.targetPhoneNumber, phoneVerified: true }) },
      $transaction: transaction(tx),
    };
    await expect(makeService(prisma).acceptInvitation(memberUser, token, request)).rejects.toThrow('already been used');
    expect(tx.familyInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: invitation.id, tokenHash: invitation.tokenHash, status: FamilyInvitationStatus.PENDING }),
    }));
  });

  it('rejects an expired claim token without linking the family member', async () => {
    const token = 'C'.repeat(43);
    const invitation = {
      id: 'invite-id', familyMemberId: memberId, senderUserId: owner,
      targetPhoneNumber: '+919876543210', tokenHash: createHash('sha256').update(token).digest('hex'),
      status: FamilyInvitationStatus.PENDING, expiresAt: new Date(Date.now() - 1000),
      familyMember: { relationship: FamilyRelationshipType.SPOUSE, fullName: 'Sam', ownerPatientProfile: { fullName: 'Alex' } },
    };
    const tx = {
      familyInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { familyInvitation: { findUnique: jest.fn().mockResolvedValue(invitation) }, $transaction: transaction(tx) };
    await expect(makeService(prisma).acceptInvitation(memberUser, token, request)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.familyInvitation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: FamilyInvitationStatus.EXPIRED },
    }));
  });

  it('does not expose records before the actual patient grants access', async () => {
    const prisma = {
      familyMember: { findFirst: jest.fn().mockResolvedValue({ id: memberId, relationship: 'SPOUSE', claimedByUserId: memberUser, ownerPatientProfileId: ownerProfile }) },
      familyAccessGrant: { findFirst: jest.fn().mockResolvedValue(null) },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
      patientProfile: { findFirst: jest.fn() },
    };
    await expect(makeService(prisma).familyRecords(owner, memberId, request)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.patientProfile.findFirst).not.toHaveBeenCalled();
    expect(prisma.familyAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'FAMILY_UNAUTHORIZED_ACCESS_ATTEMPTED' }),
    }));
  });

  it('keeps child guardian claims unverified and refuses record access grants', async () => {
    const prisma = {
      familyMember: { findFirst: jest.fn().mockResolvedValue({
        id: memberId, ownerUserId: owner, ownerPatientProfileId: ownerProfile,
        relationship: FamilyRelationshipType.CHILD,
        guardianRelationship: { verificationStatus: 'UNVERIFIED' },
      }) },
      familyAccessGrant: { create: jest.fn() },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    await expect(makeService(prisma).grantConsent(memberUser, memberId, {
      permissionTypes: ['PROFILE_BASIC'], durationDays: 1,
    }, request)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.familyAccessGrant.create).not.toHaveBeenCalled();
  });

  it('allows only the linked member account to create a bounded grant to the relationship owner', async () => {
    const created = { id: grantId, expiresAt: new Date(Date.now() + 7 * 86_400_000), permissions: [{ permissionType: 'PROFILE_BASIC' }], documents: [] };
    const tx = {
      familyAccessGrant: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue(created),
      },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      familyMember: { findFirst: jest.fn().mockResolvedValue({
        id: memberId, ownerUserId: owner, ownerPatientProfileId: ownerProfile,
        claimedByUserId: memberUser, relationship: FamilyRelationshipType.SPOUSE,
        guardianRelationship: null,
      }) },
      patientProfile: { upsert: jest.fn().mockResolvedValue({ id: memberProfile }) },
      medicalDocument: { count: jest.fn() },
      $transaction: transaction(tx),
    };
    const result = await makeService(prisma).grantConsent(memberUser, memberId, {
      permissionTypes: ['PROFILE_BASIC'], durationDays: 7,
    }, request);
    expect(result.accessGrant.id).toBe(grantId);
    expect(tx.familyAccessGrant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        patientProfileId: memberProfile,
        grantedByUserId: memberUser,
        recipientUserId: owner,
        familyMemberId: memberId,
      }),
    }));
    expect(prisma.medicalDocument.count).not.toHaveBeenCalled();
  });

  it('revokes an explicit family grant and records the revocation event', async () => {
    const tx = {
      familyAccessGrant: {
        findFirst: jest.fn().mockResolvedValue({ id: grantId }),
        update: jest.fn().mockResolvedValue({}),
      },
      familyAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      familyMember: { findFirst: jest.fn().mockResolvedValue({ id: memberId, ownerUserId: owner }) },
      $transaction: transaction(tx),
    };
    expect(await makeService(prisma).revokeConsent(memberUser, memberId, request)).toEqual({ revoked: true });
    expect(tx.familyAccessGrant.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: grantId }, data: expect.objectContaining({ status: 'REVOKED' }),
    }));
    expect(tx.familyAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'FAMILY_ACCESS_REVOKED' }),
    }));
  });
});
