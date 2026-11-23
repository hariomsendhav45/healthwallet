# Family member management and consent

## Relationship records

`FamilyMember` is owned by the authenticated patient's profile and stores only name, optional date of birth, relationship, optional contact number, and optional gender. Reads and edits are scoped to the owner account. The database ties each owner profile to its user with a composite foreign key. Adding or editing a relationship never creates a medical access grant.

## Invitation and account claim

An invitation requires a contact number in international format. The API generates 32 random bytes, stores only the SHA-256 token hash, and returns the raw token once so the patient can copy a claim link. The client puts the token in the URL fragment, which is not sent in HTTP requests; the claim page removes the fragment immediately and keeps the token only in component memory. The invitation expires after seven days. Resending creates a fresh token and revokes every still-pending token for that family relationship. A verified PATIENT account must claim it using the same verified number; the conditional pending-to-accepted/rejected update makes it single-use. Invitation links contain no health information.

There is no SMS delivery provider configured. The UI states that the patient must share the copy link privately. Tokens are not included in API logs, audit rows, list responses, or persistent browser storage. Invitation creation is rate-limited per account and IP. All family API responses are `private, no-store`.

Accepting a link establishes only the relationship. The accepted member account sees the relationship under invitations/consent and can separately grant access to their own profile, blood group, health information, specific reports, blood pressure readings, and/or glucose readings. Grant durations are limited to 1, 7, or 30 days. A current grant is revoked before a replacement is created. Only the actual linked member can grant or revoke it. The relationship owner can remove the relationship, which revokes grants and pending invitations.

Every family read re-checks the caller as the relationship owner, the linked account as grantor, the actual patient profile, grant status and expiry, permission rows, document IDs, and document ownership/availability. Medical document bodies continue through the private storage checksum verification service. Read, download, invitation, consent, rejection, expiry, and revocation actions have metadata-only family audit events.

## Child and guardian boundary

An accepted `CHILD` relationship creates a distinct `FamilyGuardianRelationship` record whose status is always `UNVERIFIED`. There is no legal identity or authority verification integration, and the status cannot be changed through an API. Family record grants and reads are blocked for child/guardian relationships, regardless of the inviter's claimed role. A parent, spouse, or other family relationship alone is never treated as legal authority.

## API routes

All routes below require a signed-in PATIENT account and are no-store:

- `POST/GET /api/patient/family/members`
- `GET/PUT/DELETE /api/patient/family/members/:id`
- `POST /api/patient/family/members/:id/invitations` (new or resend; returns the one-time token once)
- `GET /api/patient/family/invitations` (sent, incoming, and accepted links for the verified account)
- `POST /api/patient/family/invitations/accept` and `/reject`
- `POST /api/patient/family/members/:id/consent` (member-owned grant with explicit categories and duration)
- `POST /api/patient/family/members/:id/consent/revoke`
- `GET /api/patient/family/members/:id/records`
- `GET /api/patient/family/members/:id/documents/:documentId/content`

The PWA uses `/family`, `/family/add`, `/family/:id`, and `/family/invitations`.

## Operational and privacy limits

The in-memory rate limiter is a single-process development control; multi-instance deployments require shared atomic rate limiting. Copy-link delivery requires an out-of-band private channel. No guardian authority is verified, so guardian record access is unavailable. Invitation acceptance requires an already verified mobile account. No family health information is cached for offline use or stored in browser local/session storage.
