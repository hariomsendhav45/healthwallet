# Medical document design

## Data and ownership

`MedicalDocument` stores UUID metadata, the owning `PatientProfile`, the authenticated uploader, category, optional report date and description, safe display filename, MIME type, byte size, SHA-256 checksum, scan status, upload status, UTC timestamps, and soft-delete timestamp. Raw bytes are never stored in PostgreSQL. Every query is scoped to both the authenticated `uploadedByUserId` and its `patientProfile.userId`; client-provided patient identifiers are not accepted.

The allowed categories are BLOOD_TEST, URINE_TEST, RADIOLOGY, X_RAY, MRI, CT_SCAN, ULTRASOUND, PRESCRIPTION, DISCHARGE_SUMMARY, CONSULTATION_REPORT, ECG, and OTHER. Supported files are PDF, JPEG, and PNG. Default size limit is 15 MiB, configurable with `MEDICAL_DOCUMENT_MAX_UPLOAD_BYTES` (1 byte to 100 MiB).

## Upload lifecycle

`POST /api/patient/documents/upload` receives a single multipart file and metadata through the authenticated API. The backend checks extension, declared MIME, file signature, configured size, runs the configured scanner, stores the object under a random UUID key, verifies stored length and SHA-256, and only then creates an AVAILABLE record. A failed database write triggers best-effort object cleanup. There is no client-completable pending session, so upload completion cannot be replayed. Browser retries create a new upload and cancellation warns users to check their list if the server completed first.

The development scanner returns `NOT_SCANNED` and is explicitly not antivirus. Production startup requires the ClamAV scanner and S3 storage configuration. ClamAV errors fail closed. Documents become available after all enabled checks and private-object verification succeed.

## API

- `POST /api/patient/documents/upload` upload and verify a document.
- `GET /api/patient/documents` list and filter by query, category, report date, upload date, and MIME type; page size is capped at 100.
- `GET /api/patient/documents/:id` metadata.
- `GET /api/patient/documents/:id/content` authorized preview; `?download=true` returns an attachment.
- `PATCH /api/patient/documents/:id` edit title, category, report date, and description.
- `DELETE /api/patient/documents/:id` marks the record DELETING, removes the private object, then soft-deletes metadata. If object deletion fails, the document remains inaccessible and the owner may retry deletion.

The API streams document bytes after ownership checks; it does not issue permanent or public object URLs. Download/preview responses have `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and a restrictive content security policy. Audit rows record event type, actor, and request IP only; they do not include filenames, metadata, contents, tokens, or storage keys.

## Retention

Deletion is a soft-delete of metadata combined with immediate private object removal. If storage is unavailable, state remains DELETING and all reads are blocked while deletion can be retried. No automatic retention purger is implemented; operators must monitor and reconcile DELETING records before deployment. Account/profile cascades remove relational metadata; production backup and object lifecycle retention must be configured consistently.
