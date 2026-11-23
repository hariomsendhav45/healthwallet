# Patient consent design

Patients must explicitly choose at least one category before the API creates a session. Medical reports require the `MEDICAL_DOCUMENTS` permission and one or more specific report IDs owned by the signed-in patient; report IDs supplied without that permission are rejected. The API never selects all records by default.

Available permissions are basic profile (name, DOB and gender only), blood group, basic health information, selected medical documents, blood pressure readings, and blood glucose readings. The patient chooses a 5-, 15-, 30-, or 60-minute QR duration. The patient can revoke the session, which revokes all grants derived from it.

After a verified doctor scans the QR, the patient sees that doctor’s displayed name and registration details if provided, a notice that those professional credentials are self-reported and not independently verified by this app, requested categories, exact selected report names, request time and expiry. The patient may approve or reject. A scan alone never grants access. Duplicate approval/rejection and requests for another patient’s request ID are rejected.

The patient can view active/expired/revoked sessions, pending requests, and chronological sharing/access audit history. Approval gives access only to the session’s selected categories and expires no later than the QR session. Both patient session revocation and doctor self-revocation immediately block future API reads.
