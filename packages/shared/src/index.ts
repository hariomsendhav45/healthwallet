export type UserRole = 'PATIENT' | 'DOCTOR' | 'ADMIN';
export type OtpPurpose = 'REGISTER' | 'LOGIN' | 'RECOVERY';
export type AuthPlatform = 'WEB';
export type UUID = string;

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface HealthStatus {
  status: 'ok';
  service: 'healthvault-api';
  timestamp: string;
}

export interface UserIdentity {
  id: UUID;
  role: UserRole;
}

export interface AuthUser extends UserIdentity {
  phoneNumber: string;
  phoneVerified: boolean;
  accountStatus: 'ACTIVE' | 'SUSPENDED';
  doctorVerificationStatus: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | null;
}

export interface OtpChallengeResponse {
  challengeId: UUID;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  message: string;
}

export interface AuthSessionResponse {
  user: AuthUser;
  accessTokenExpiresIn: number;
}

export interface AuthSessionSummary {
  id: UUID;
  deviceId: string | null;
  deviceName: string | null;
  platform: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export type PatientGender = 'FEMALE' | 'MALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY';
export type PatientBloodGroup =
  | 'A_POSITIVE'
  | 'A_NEGATIVE'
  | 'B_POSITIVE'
  | 'B_NEGATIVE'
  | 'AB_POSITIVE'
  | 'AB_NEGATIVE'
  | 'O_POSITIVE'
  | 'O_NEGATIVE'
  | 'UNKNOWN';
export type DiabetesStatus = 'UNKNOWN' | 'YES' | 'NO' | 'PREDIABETES';
export type HypertensionStatus = 'UNKNOWN' | 'YES' | 'NO';

export interface PatientProfile {
  fullName: string | null;
  dateOfBirth: string | null;
  gender: PatientGender | null;
  bloodGroup: PatientBloodGroup | null;
  mobileNumber: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
}

export interface PatientHealthInformation {
  diabetesStatus: DiabetesStatus;
  hypertensionStatus: HypertensionStatus;
  allergies: string | null;
  existingMedicalConditions: string | null;
  currentMedications: string | null;
  additionalNotes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PatientProfileCompletion {
  completionPercent: number;
  missingFields: string[];
  recommendedFields: string[];
}

export type GlucoseUnit = 'MG_DL' | 'MMOL_L';
export type GlucoseMeasurementType =
  'FASTING' | 'POST_MEAL' | 'RANDOM' | 'BEFORE_MEAL' | 'AFTER_MEAL' | 'BEDTIME' | 'OTHER';

export interface BloodPressureReading {
  id: UUID;
  systolic: number;
  diastolic: number;
  heartRate: number | null;
  measuredAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BloodGlucoseReading {
  id: UUID;
  glucoseValue: number;
  glucoseUnit: GlucoseUnit;
  measurementType: GlucoseMeasurementType;
  measuredAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResponse<T> {
  readings: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface HealthTrackingSummary {
  totalBloodPressureReadings: number;
  latestBloodPressureReading: BloodPressureReading | null;
  latestBloodPressureMeasuredAt: string | null;
  totalGlucoseReadings: number;
  latestGlucoseReading: BloodGlucoseReading | null;
  latestGlucoseMeasuredAt: string | null;
  bloodPressureReadingsInRange: number;
  glucoseReadingsInRange: number;
}

export type MedicalSharePermission =
  | 'PROFILE_BASIC'
  | 'BLOOD_GROUP'
  | 'HEALTH_INFORMATION'
  | 'MEDICAL_DOCUMENTS'
  | 'BLOOD_PRESSURE_READINGS'
  | 'BLOOD_GLUCOSE_READINGS';

export interface MedicalShareSessionSummary {
  id: UUID;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  maxUses: number;
  useCount: number;
  permissions: Array<{ permissionType: MedicalSharePermission }>;
  documents: Array<{
    medicalDocument: { id: UUID; title: string; category: string; documentDate: string | null };
  }>;
  accessRequests?: Array<{
    id: UUID;
    status: string;
    requestedAt: string;
    accessGrant?: { status: string; expiresAt: string; revokedAt: string | null } | null;
    doctor?: MedicalShareDoctorDisplay;
  }>;
}

export interface MedicalShareDoctorDisplay {
  doctorProfile: {
    fullName: string | null;
    professionalRegistrationNo: string | null;
    registrationAuthority: string | null;
  } | null;
}

export type FamilyRelationship = 'PARENT' | 'SPOUSE' | 'CHILD' | 'SIBLING' | 'OTHER';
export type FamilyAccessStatus =
  | 'NO_ACCESS'
  | 'ACTIVE'
  | 'CONNECTED_NO_ACCESS'
  | 'NOT_INVITED'
  | 'GUARDIAN_UNVERIFIED_NO_ACCESS'
  | 'PENDING'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'REVOKED'
  | 'EXPIRED';

export interface FamilyMemberSummary {
  id: UUID;
  fullName: string;
  dateOfBirth: string | null;
  relationship: FamilyRelationship;
  contactNumber: string | null;
  gender: PatientGender | null;
  claimedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
  invitation: { id: UUID; status: string; expiresAt: string; createdAt: string } | null;
  accessGrant: {
    id: UUID;
    status?: string;
    expiresAt: string;
    grantedAt?: string;
    permissions: Array<{ permissionType: MedicalSharePermission }>;
    documents?: Array<{ medicalDocumentId: UUID }>;
  } | null;
  accessStatus: FamilyAccessStatus;
}

export interface FamilyInvitationSummary {
  id: UUID;
  status: string;
  expiresAt: string;
  createdAt: string;
}
