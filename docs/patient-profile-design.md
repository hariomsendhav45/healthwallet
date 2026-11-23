# Patient profile design

Each authenticated PATIENT account can create one profile, stored in `PatientProfile` with a unique `userId` foreign key. API routes never accept an owner ID. The API reads the user ID from the verified session and rejects non-patient roles. A public lookup by profile UUID is not provided.

The profile includes optional full name, date of birth, gender, blood group, address, and emergency contact. The account’s verified mobile number remains authoritative on `User` and is returned read-only. DOB is stored as a PostgreSQL `DATE`; timestamps use UTC. Profile fields can be completed gradually or cleared with `null`.

`GET /api/patient/profile` returns `profile: null` when no profile exists. `PUT /api/patient/profile` creates or updates the caller’s profile. `GET /api/patient/profile/completion` recommends name, DOB, gender, and blood group but does not require them.

Create/update writes an audit event with actor ID and IP only. Profile field values are not logged. Profile photo storage is not implemented; `profilePhotoKey` is reserved for a future private-storage design and is not returned by the API.
