# Blood glucose tracking

## Data and units

`BloodGlucoseReading` stores a UUID, owning `PatientProfile` relation, `DECIMAL(7,2)` glucose value, unit enum (`MG_DL` or `MMOL_L`), measurement type enum (`FASTING`, `POST_MEAL`, `RANDOM`, `BEFORE_MEAL`, `AFTER_MEAL`, `BEDTIME`, or `OTHER`), UTC measurement instant, optional note (maximum 1,000 characters), timestamps, and a soft-delete timestamp. Indexes support patient history and filtering by unit/type. The initial form defaults to mg/dL.

The chosen value and unit are saved as entered. This version does not convert values. The dashboard gives mg/dL and mmol/L separate charts so incompatible values are never combined. If a later feature needs a conversion for comparison, document and consistently apply `mg/dL = mmol/L × 18.0182` while preserving the original stored value and unit.

## Validation

Values must be positive, have no more than two decimal places, and fall within configured input limits. Defaults are 1–2,000 mg/dL and 0.1–111.1 mmol/L; tune with `GLUCOSE_MG_DL_MIN/MAX` and `GLUCOSE_MMOL_L_MIN/MAX` in `.env.example`. These are configurable input-error bounds, not clinical thresholds. Unusual readings inside them remain recordable. The API rejects invalid units/types, malformed date-times, notes over 1,000 characters, and measurements more than five minutes in the future.

## API and privacy

Routes and query filters are documented in [API design](api-design.md). Every endpoint requires an authenticated PATIENT session. Patient ownership comes from the session; another patient’s ID cannot be used to access or alter a reading. Deletion is soft (`deletedAt`) and removes the row from all normal queries. Create/update/delete events are audited without storing glucose values, measurement types, or notes in audit metadata. Requests and responses are not cached and data is not available offline.

The accessible history table labels the selected unit and meal context. Charts use only real, authenticated API readings and show measurement dates without interpolation. HealthVault does not diagnose diabetes or recommend treatment; consult a qualified healthcare professional for interpretation.
