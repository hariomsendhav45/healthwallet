# Blood pressure tracking

## Data and units

`BloodPressureReading` stores UUID, owning `PatientProfile` relation, integer systolic and diastolic values in mmHg, optional integer heart rate in bpm, `measuredAt` as a UTC `TIMESTAMPTZ`, optional note (maximum 1,000 characters), create/update timestamps, and a soft-delete timestamp. A composite owner/deletion/measurement-time index supports recent history. Database constraints require positive pressure values, diastolic below systolic, and positive optional heart rate.

## Validation

The API rejects malformed values, systolic or diastolic outside configured entry bounds, diastolic greater than or equal to systolic, invalid timestamps, notes longer than 1,000 characters, and measurements more than five minutes ahead of the API clock. Default bounds are systolic 40–300 mmHg, diastolic 20–200 mmHg, and heart rate 20–250 bpm. Environment values in `.env.example` can tune those bounds for the deployment. These limits guard likely input mistakes; they are not healthy/unhealthy thresholds and do not diagnose a condition. Unusual readings within the configured bounds remain recordable.

The client sends an ISO timestamp representing the selected local date and time. The API stores the instant in UTC. Responses are rendered in the browser’s local timezone.

## API and privacy

Routes are listed in [API design](api-design.md). Create, list, retrieve, patch, and soft-delete operations require an authenticated PATIENT session. The server derives the profile from the session account and hides reading records belonging to other patients as not found. Deletion sets `deletedAt`; deleted rows are excluded from all read, chart, summary, and edit paths. Mutations use a transaction to store the reading and a metadata-only audit event (account, event type, IP); measurement values and notes never enter the audit log.

The UI offers editable history and an accessible table alongside a chart with systolic and diastolic lines in mmHg. It does not interpolate missing measurements. The app is a record keeper, not a diagnostic or emergency-monitoring service. Ask a qualified healthcare professional to interpret readings; seek timely care for concerning symptoms or measurements.
