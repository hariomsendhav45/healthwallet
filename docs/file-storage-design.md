# Private file storage

NestJS depends on a `MedicalDocumentStorage` abstraction with put/get/head/delete operations.

## Local development

`DOCUMENT_STORAGE_PROVIDER=local` uses mode-0600 files in a mode-0700 private directory outside Next.js public assets. The default is `%LOCALAPPDATA%/HealthVault/private-medical-documents` on Windows and `~/.healthvault/private-medical-documents` elsewhere; set `MEDICAL_DOCUMENT_LOCAL_DIR` to an absolute path when desired. On Windows, files inherit the current user profile ACL. This provider is allowed only in development and tests and must not be used for production.

## S3-compatible production

Set `DOCUMENT_STORAGE_PROVIDER=s3`, `MEDICAL_DOCUMENT_S3_BUCKET`, `MEDICAL_DOCUMENT_S3_REGION`, and optionally `MEDICAL_DOCUMENT_S3_ENDPOINT` for an S3-compatible endpoint. `MEDICAL_DOCUMENT_S3_FORCE_PATH_STYLE=true` supports providers such as MinIO. Supply `MEDICAL_DOCUMENT_S3_ACCESS_KEY_ID` and `MEDICAL_DOCUMENT_S3_SECRET_ACCESS_KEY` through a secret manager, or use the AWS SDK default credential chain (for example, a workload role). The application sets AES256 server-side encryption and never grants public ACLs.

Create the bucket privately with all public access blocked, encryption and TLS required, and least-privilege access limited to the application role. The API fetches and streams files only after authorization; no browser receives S3 credentials or a public URL. Cloud configuration is not provisioned by this repository and no paid storage account is connected.

Required security variables and examples are in `.env.example`. Do not commit real storage credentials.
