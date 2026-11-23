import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { DOCUMENT_STORAGE, MedicalDocumentStorage } from '../medical-documents/storage/storage-provider.interface';
import { MEDICAL_DOCUMENT_SCANNER, MedicalDocumentScanner } from '../medical-documents/file-scanner.interface';
import { validateMedicalDocumentFile } from '../medical-documents/medical-documents.service';
import { DoctorReviewDto } from './doctor-verification.dto';

type File = { buffer: Buffer; originalname: string; mimetype: string; size: number };
@Injectable()
export class DoctorVerificationService {
  private readonly maxBytes: number;
  constructor(private readonly prisma: PrismaService, config: ConfigService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: MedicalDocumentStorage,
    @Inject(MEDICAL_DOCUMENT_SCANNER) private readonly scanner: MedicalDocumentScanner) {
    this.maxBytes = Number(config.get<string>('MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES', '15728640'));
  }

  async submit(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { doctorProfile: { include: { documents: true } } } });
    if (!user || user.role !== 'DOCTOR' || !user.phoneVerified) throw new ForbiddenException('A mobile-verified doctor account is required.');
    const p = user.doctorProfile;
    if (!p?.fullName || !p.professionalRegistrationNo || !p.registrationAuthority || !p.qualification || !p.specialization || !p.documents.length)
      throw new BadRequestException('Complete required profile details and upload at least one registration document before submitting.');
    if (user.doctorVerificationStatus === 'APPROVED' || user.doctorVerificationStatus === 'SUSPENDED') throw new BadRequestException('This application cannot be submitted in its current status.');
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { doctorVerificationStatus: 'UNDER_REVIEW' } });
    return { status: updated.doctorVerificationStatus, message: 'Submitted for manual HealthVault administrator review. This is not registry verification.' };
  }

  async upload(userId: string, file?: File) {
    if (!file) throw new BadRequestException('Choose a PDF, JPEG or PNG registration document.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, phoneVerified: true, doctorVerificationStatus: true, doctorProfile: { select: { id: true } } } });
    if (user?.role !== 'DOCTOR' || !user.phoneVerified) throw new ForbiddenException('A mobile-verified doctor account is required.');
    if (['APPROVED', 'UNDER_REVIEW', 'SUSPENDED'].includes(user.doctorVerificationStatus ?? '')) throw new BadRequestException('Documents cannot be changed while approved or under review. Contact an administrator.');
    if (file.size > this.maxBytes || file.buffer.byteLength > this.maxBytes || file.size <= 0) throw new BadRequestException('The selected file is empty or exceeds the configured upload limit.');
    const { originalFileName, extension, mimeType } = validateMedicalDocumentFile(file, this.maxBytes);
    const scanStatus = await this.scanner.scan(file.buffer);
    if (scanStatus !== 'CLEAN' && process.env.NODE_ENV === 'production') throw new UnprocessableEntityException('Document scanning is unavailable.');
    const profile = user.doctorProfile ?? await this.prisma.doctorProfile.create({ data: { userId }, select: { id: true } });
    const key = `${randomUUID()}${extension}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    await this.storage.put(key, file.buffer, mimeType, checksum);
    try {
      const document = await this.prisma.doctorVerificationDocument.create({ data: { doctorProfileId: profile.id, originalFileName, storageKey: key, mimeType, fileSize: file.size, fileChecksum: checksum, scanStatus }, select: { id: true, originalFileName: true, mimeType: true, fileSize: true, scanStatus: true, createdAt: true } });
      return { document };
    } catch (e) { await this.storage.delete(key).catch(() => undefined); throw e; }
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, doctorVerificationStatus: true, doctorProfile: { select: { documents: { select: { id: true, originalFileName: true, scanStatus: true, createdAt: true } }, audit: { orderBy: { createdAt: 'desc' }, take: 20, select: { fromStatus: true, toStatus: true, reason: true, createdAt: true } } } } } });
    if (user?.role !== 'DOCTOR') throw new ForbiddenException('Doctor account required.');
    return { status: user.doctorVerificationStatus, documents: user.doctorProfile?.documents ?? [], history: user.doctorProfile?.audit ?? [], notice: 'HealthVault administrator review is not independent medical council or registry verification.' };
  }

  async dashboard(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, doctorVerificationStatus: true } });
    if (user?.role !== 'DOCTOR') throw new ForbiddenException('Doctor account required.');
    const requests = user.doctorVerificationStatus === 'APPROVED' ? await this.prisma.doctorAccessRequest.count({ where: { doctorUserId: userId, status: 'PENDING', expiresAt: { gt: new Date() } } }) : 0;
    return { status: user.doctorVerificationStatus, pendingPatientRequests: requests };
  }

  async adminList(status?: string) {
    return this.prisma.user.findMany({ where: { role: 'DOCTOR', ...(status ? { doctorVerificationStatus: status as never } : {}) }, select: { id: true, phoneNumber: true, doctorVerificationStatus: true, doctorProfile: { select: { id: true, fullName: true, professionalRegistrationNo: true, registrationAuthority: true, qualification: true, specialization: true, clinicName: true, clinicAddress: true, email: true, documents: { select: { id: true, originalFileName: true, mimeType: true, fileSize: true, scanStatus: true, createdAt: true } }, audit: { orderBy: { createdAt: 'desc' }, take: 10, select: { reviewerUserId: true, fromStatus: true, toStatus: true, reason: true, createdAt: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
  }

  async adminDetail(doctorId: string) {
    const doctor = await this.prisma.user.findFirst({
      where: { id: doctorId, role: 'DOCTOR' },
      select: {
        id: true,
        phoneNumber: true,
        doctorVerificationStatus: true,
        doctorProfile: {
          select: {
            id: true,
            fullName: true,
            professionalRegistrationNo: true,
            registrationAuthority: true,
            qualification: true,
            specialization: true,
            clinicName: true,
            clinicAddress: true,
            email: true,
            documents: {
              select: {
                id: true,
                originalFileName: true,
                mimeType: true,
                fileSize: true,
                scanStatus: true,
                createdAt: true,
              },
            },
            audit: {
              orderBy: { createdAt: 'desc' },
              take: 50,
              select: { reviewerUserId: true, fromStatus: true, toStatus: true, reason: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!doctor?.doctorProfile) throw new NotFoundException('Doctor application not found.');
    return doctor;
  }

  async review(actorId: string, doctorId: string, dto: DoctorReviewDto) {
    const target = await this.prisma.user.findUnique({ where: { id: doctorId }, select: { id: true, role: true, accountStatus: true, doctorVerificationStatus: true, phoneVerified: true, doctorProfile: { select: { id: true, fullName: true, professionalRegistrationNo: true, registrationAuthority: true, qualification: true, specialization: true, documents: { select: { scanStatus: true } } } } } });
    if (!target || target.role !== 'DOCTOR' || !target.doctorProfile) throw new NotFoundException('Doctor application not found.');
    if (dto.status === 'APPROVED' && (!target.phoneVerified || target.accountStatus !== 'ACTIVE' || !target.doctorProfile.fullName || !target.doctorProfile.professionalRegistrationNo || !target.doctorProfile.registrationAuthority || !target.doctorProfile.qualification || !target.doctorProfile.specialization || !target.doctorProfile.documents.length || target.doctorProfile.documents.some(d => d.scanStatus !== 'CLEAN'))) throw new BadRequestException('An active verified mobile, complete application details, and clean registration documents are required to approve.');
    if (dto.status === 'UNDER_REVIEW' && !['PENDING','REJECTED'].includes(target.doctorVerificationStatus ?? '')) throw new BadRequestException('Invalid review transition.');
    if (dto.status === 'REJECTED' && !['PENDING','UNDER_REVIEW'].includes(target.doctorVerificationStatus ?? '')) throw new BadRequestException('Invalid rejection transition.');
    if (dto.status === 'SUSPENDED' && target.doctorVerificationStatus !== 'APPROVED') throw new BadRequestException('Only an approved doctor can be suspended.');
    if (dto.status === 'APPROVED' && !['UNDER_REVIEW','SUSPENDED'].includes(target.doctorVerificationStatus ?? '')) throw new BadRequestException('Only an under-review or suspended application can be approved.');
    await this.prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: doctorId }, data: { doctorVerificationStatus: dto.status } });
      await tx.doctorVerificationAudit.create({ data: { doctorProfileId: target.doctorProfile!.id, reviewerUserId: actorId, fromStatus: target.doctorVerificationStatus ?? 'PENDING', toStatus: dto.status, reason: dto.reason } });
    });
    return { doctorId, status: dto.status, reviewedAt: new Date(), notice: 'Decision records HealthVault administrative review; it does not assert independent medical council verification.' };
  }

  async document(actorId: string, doctorId: string, documentId: string) {
    const doc = await this.prisma.doctorVerificationDocument.findFirst({ where: { id: documentId, doctorProfile: { userId: doctorId } } });
    if (!doc) throw new NotFoundException('Document not found.');
    await this.prisma.doctorVerificationDocumentAccessLog.create({ data: { documentId: doc.id, actorUserId: actorId } });
    return { body: await this.storage.get(doc.storageKey), mimeType: doc.mimeType, fileName: doc.originalFileName };
  }
}
