# Health information design

`PatientHealthInformation` is a one-to-one child of `PatientProfile`. It contains patient-provided diabetes and hypertension status enums, plus optional text fields for allergies, existing conditions, current medications, and additional notes. Text fields are capped at 4,000 characters in API DTOs. Blood group is stored only on `PatientProfile`.

The status fields default to UNKNOWN. Free text is used for the first profile phase because there is no clinical terminology, coding, provenance, or structured medication model yet. The application does not interpret this content, generate a diagnosis, recommend medication, track values over time, or provide medical advice.

Access is limited to the authenticated owner’s PATIENT account. Updates create audit events without health text. Requests use `cache: no-store`, responses are not cached by the service worker, and offline health information is unavailable. Health text is never placed in a URL, QR code, logs, fixtures, or examples.
