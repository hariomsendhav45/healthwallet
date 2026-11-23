# Phase 4 Predictive Analytics and Preventive Intelligence

## Available endpoint and interface

`GET /api/patient/health-intelligence/risk-trends` is patient-role protected, derives ownership from the authenticated user, and returns `Cache-Control: private, no-store`. It reads only that patient's non-deleted blood-pressure/glucose readings and patient-reviewed OCR values from their available documents. The analysis is local and does not require or send data to the external AI provider.

The Health insights page includes a **Health risk trends** panel with observation counts/period, repeated explicit report flags, personal-history statistical deviations, descriptive linear trends, source links, data-quality issues, and insufficient-history reasons.

## Statistical and rule behavior

- Statistical trends require at least five compatible observations spanning at least 30 days. Values are grouped by exact test name and unit; glucose is further separated by original unit and measurement type.
- Trend slopes describe observed values per 30 days. Their approximate intervals and direction uncertainty describe a linear fit only; there is no future extrapolation.
- A deviation is surfaced only when a current value differs by at least three median absolute deviations from at least five preceding compatible observations. This is a personal-history heuristic, not a clinically reviewed alert.
- Repeated report flags are surfaced only when at least two patient-reviewed reports explicitly flag the same test and unit. The source flags remain unverified clinical content and are linked back to their reports.
- Future-dated, non-positive, missing-unit/name/value/date, invalid numeric, and duplicate-timestamp observations are reported as data-quality concerns where detectable.
- Insufficient measurements are explicitly identified. BMI is not part of the current structured schema and is never inferred.

## Model availability, provenance, and limitations

Rule version: `descriptive-health-trends-2026-11-v1`. The response includes generation timestamp, rule version, validation status, observation period, and source references for generated statistics. No validated clinical risk model or clinician-reviewed rule set exists in this repository, so model-based estimates, disease predictions, clinical thresholds, and risk percentages are disabled. This output is descriptive and not clinically validated. The project does not claim clinical accuracy or clinical review.

Results are computed per request rather than persisted as health snapshots. This avoids keeping an additional copy of sensitive patient data; response metadata records the provenance for that analysis. No database migration was required.

Phase 2 OCR and RAG limitations still apply: actual scanned-document OCR configuration and curated knowledge ingestion have not been verified. They are not prerequisites for this deterministic trend endpoint; unreviewed OCR values are excluded.
