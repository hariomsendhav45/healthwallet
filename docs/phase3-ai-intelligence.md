# Phase 3 AI Health Intelligence

## Implemented

- Patient-only `/api/patient/health-intelligence/overview` summarizes reviewed OCR flags, numeric trends whose test name and unit match, blood-pressure and glucose history, pending OCR reviews, and profile completeness. It reads only records owned by the authenticated patient.
- Patient-only `/api/patient/health-intelligence/compare` compares two owned reports. It includes only reviewed OCR values with matching test names and units, cites both document IDs/titles/dates, and reports unmatched values separately.
- Patient reminders support appointment, patient follow-up, report review, and patient-configured measurement categories. APIs enforce owner scoping; the PWA supports create, list, edit, complete, disable, and delete. Optional browser notifications run only while the reminders page is open and permission is granted.
- AI response feedback stores a response UUID, helpful rating, and optional category only. It does not store prompts, generated answers, free-text comments, or training data.
- The server applies English/Hindi urgent-symptom and diagnosis/medication-change gates before retrieving records, checking provider configuration, or calling an external AI provider. The ordinary AI prompt has a version identifier and treats user input, report text, and retrieved text as untrusted.
- The dashboard links to real record summaries and the comparison page; the PWA trend view draws charts only from actual patient records.
- AI integration remains disabled unless existing backend provider configuration and active patient consent are present. No patient data is sent by the deterministic insights or comparison endpoints.

## Database

Migrations `20261121150000_phase3_health_intelligence` and `20261121160000_ai_response_receipts` add patient-owned reminders, enum-only AI feedback, and expiring response receipts to bind feedback to an actual response. Both were applied to the local PostgreSQL database with `prisma migrate deploy`; Prisma reported 19 migrations up to date afterward. No historical migration was changed.

## Evaluation and limitations

`apps/api/test/ai-phase3.spec.ts` covers local urgent guidance, diagnosis/dose refusal, report ownership, matching-unit comparisons, and cross-profile rejection. `apps/api/test/ai-phase3.evaluation.json` is a synthetic regression checklist, not a clinical accuracy report. No medical professional has reviewed the dataset or outputs, and no clinical validation, model training, or fine-tuning has been performed.

OCR values are included in trends only after patient review. A report flag is repeated only when the reviewed extraction contains the same test and unit with an explicit flag; the app does not interpret a laboratory reference range or infer clinical risk. The chart view is descriptive, not a medically calibrated scale. Reminder browser notifications are not background/push notifications and will not fire after the page closes.

Phase 2 still requires actual scanned-document OCR engine/language-data verification and curated medical knowledge ingestion before its OCR and RAG acceptance can be claimed. OpenAI and OCR provider configuration remain controlled by existing environment settings. The health assistant must remain disabled until the provider account is configured and the patient chooses AI processing consent.
