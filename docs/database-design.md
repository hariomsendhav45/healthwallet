# Database design

The canonical schema is `prisma/schema.prisma`. Phase 1 authentication is in `20261105000000_phase1_auth`; Phase 2 profile data is added non-destructively in `20261106000000_patient_profile`. Apply with `npm run prisma:migrate:dev` locally or `npm run prisma:migrate:deploy` for reviewed migrations. Do not reset an existing database.

## Authentication models

- `User`: unique E.164 phone, role and account state, verification and timestamps.
- `OtpChallenge`: keyed OTP hash, purpose, optional requested role, expiry, attempt counts, single-use timestamp.
- `RefreshSession`: account relation, unique refresh-token hash, device metadata, expiry/revocation.
- `AuthAuditLog`: nullable account, event type, optional IP/device metadata and timestamp. No OTPs, tokens, or patient content.

## Patient profile models

- `PatientProfile`: unique one-to-one relation to a patient `User`, optional name, date-only DOB, gender, authoritative blood group, optional address and emergency contact fields, optional future private-storage key, and UTC creation/update timestamps.
- `PatientHealthInformation`: unique one-to-one relation to a profile, diabetes and hypertension status enums, and patient-entered text for allergies, conditions, medications, and notes. Blood group is stored only on `PatientProfile`.

The health text fields are intentionally plain text with bounded API lengths. This keeps the initial model small and treats the entries as patient-provided context; the system does not parse them into diagnoses or provide medical advice. A later clinical workflow would need a separately reviewed vocabulary and provenance model.

## Future models

Future entities may include medical records in private object storage, readings, consultations, appointments, access grants, consent records, and opaque QR sharing references. Each must have explicit owner/resource scoping, relevant indexes, UTC timestamps, audit coverage, and migrations.

Phase 3 adds `MedicalDocument`: UUID metadata linked to the patient profile and authenticated uploader; category, optional report date/description, sanitized original filename, opaque storage key, MIME type, size, SHA-256 checksum, upload/scan statuses, timestamps, and soft-delete timestamp. File contents remain outside PostgreSQL. See [medical document design](medical-document-design.md).

## Rules

Use UUID primary keys, UTC timestamps, foreign keys, unique constraints, and ownership lookup indexes. A family relationship alone does not authorize access. Plan retention/deletion and field protection with privacy and legal review before production. Avoid unnecessary sensitive fields.
