import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedRequest } from '../auth/guards/auth.guard';
import {
  UpdatePatientHealthInformationDto,
  UpdatePatientProfileDto,
} from './dto/patient-profile.dto';

@Injectable()
export class PatientProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string, request: AuthenticatedRequest) {
    const profile = await this.prisma.$transaction(async (tx) => {
      const result = await tx.patientProfile.findUnique({
        where: { userId },
        select: {
          fullName: true,
          dateOfBirth: true,
          gender: true,
          bloodGroup: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
          user: { select: { phoneNumber: true } },
        },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          eventType: 'PATIENT_PROFILE_VIEWED',
          ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        },
      });
      return result;
    });
    if (!profile) return { profile: null };
    const { user, ...safeProfile } = profile;
    return { profile: { ...safeProfile, mobileNumber: user.phoneNumber } };
  }

  async updateProfile(userId: string, dto: UpdatePatientProfileDto, request: AuthenticatedRequest) {
    if (dto.dateOfBirth) {
      const date = new Date(dto.dateOfBirth);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (Number.isNaN(date.getTime()) || date > today) {
        throw new BadRequestException('Enter a valid date of birth.');
      }
    }
    const { dateOfBirth, emergencyContactPhone, ...profileFields } = dto;
    const data = {
      ...profileFields,
      ...(dateOfBirth !== undefined
        ? { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }
        : {}),
      ...(emergencyContactPhone !== undefined
        ? {
            emergencyContactPhone: emergencyContactPhone
              ? emergencyContactPhone.startsWith('+91')
                ? emergencyContactPhone
                : `+91${emergencyContactPhone}`
              : null,
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.patientProfile.findUnique({ where: { userId } });
      const profile = await tx.patientProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
        select: {
          fullName: true,
          dateOfBirth: true,
          gender: true,
          bloodGroup: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          country: true,
          emergencyContactName: true,
          emergencyContactPhone: true,
          user: { select: { phoneNumber: true } },
        },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          eventType: existing ? 'PATIENT_PROFILE_UPDATED' : 'PATIENT_PROFILE_CREATED',
          ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        },
      });
      const { user, ...safeProfile } = profile;
      return { profile: { ...safeProfile, mobileNumber: user.phoneNumber } };
    });
  }

  async getHealthInformation(userId: string, request: AuthenticatedRequest) {
    const info = await this.prisma.$transaction(async (tx) => {
      const result = await tx.patientHealthInformation.findFirst({
        where: { patientProfile: { userId } },
        select: {
          diabetesStatus: true,
          hypertensionStatus: true,
          allergies: true,
          existingMedicalConditions: true,
          currentMedications: true,
          additionalNotes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          eventType: 'PATIENT_HEALTH_INFORMATION_VIEWED',
          ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        },
      });
      return result;
    });
    return { healthInformation: info };
  }

  async updateHealthInformation(
    userId: string,
    dto: UpdatePatientHealthInformationDto,
    request: AuthenticatedRequest,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.patientProfile.upsert({
        where: { userId },
        create: { userId },
        update: {},
        select: { id: true },
      });
      const existing = await tx.patientHealthInformation.findUnique({
        where: { patientProfileId: profile.id },
        select: { id: true },
      });
      const healthInformation = await tx.patientHealthInformation.upsert({
        where: { patientProfileId: profile.id },
        create: { patientProfileId: profile.id, ...dto },
        update: dto,
        select: {
          diabetesStatus: true,
          hypertensionStatus: true,
          allergies: true,
          existingMedicalConditions: true,
          currentMedications: true,
          additionalNotes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          eventType: existing
            ? 'PATIENT_HEALTH_INFORMATION_UPDATED'
            : 'PATIENT_HEALTH_INFORMATION_CREATED',
          ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        },
      });
      return { healthInformation };
    });
  }

  async getCompletion(userId: string, request: AuthenticatedRequest) {
    const profile = await this.prisma.$transaction(async (tx) => {
      const result = await tx.patientProfile.findUnique({
        where: { userId },
        select: { fullName: true, dateOfBirth: true, gender: true, bloodGroup: true },
      });
      await tx.authAuditLog.create({
        data: {
          userId,
          eventType: 'PATIENT_PROFILE_VIEWED',
          ...(request.ip ? { ipAddress: request.ip.slice(0, 64) } : {}),
        },
      });
      return result;
    });
    const fields = [
      ['fullName', profile?.fullName],
      ['dateOfBirth', profile?.dateOfBirth],
      ['gender', profile?.gender],
      ['bloodGroup', profile?.bloodGroup],
    ] as const;
    const missingFields = fields.filter(([, value]) => !value).map(([name]) => name);
    return {
      completionPercent: Math.round(((fields.length - missingFields.length) / fields.length) * 100),
      missingFields,
      recommendedFields: ['fullName', 'dateOfBirth', 'gender', 'bloodGroup'],
    };
  }
}
