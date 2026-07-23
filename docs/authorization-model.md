# Paradox Connect Authorization Model

**Status:** Locked product and security decision

This document is the authority for account roles, administrative authority, and
post-login role selection. Implementation changes should preserve these rules.

## Account and role rules

- The system has exactly one Super Admin.
- The Super Admin cannot be demoted, removed, or deactivated through an
  application role-management operation.
- Only the Super Admin can grant or remove the global Admin role.
- Admins cannot grant, remove, or otherwise alter the Admin or Super Admin role,
  including on another Admin account.
- Public registration creates only a participant/student account. A registration
  request must not accept or infer an elevated role.
- Authorized Admins may grant operational roles or assignments such as
  volunteer, staff, or organizer access. Operational access remains scoped
  through active `staff_assignments`.
- A person may retain participant access while also holding one or more elevated
  operational roles. The data model must not split those personas into separate
  user collections or accounts.

## Login and role selection

- Every account uses the same login page and authentication flow.
- After authentication, the backend returns the roles/views currently available
  to that user.
- When more than one view is available, the user chooses how they want to enter:
  for example Participant, Volunteer/Staff, Organizer, or Admin.
- Participant view remains available to elevated users so they can use the
  participant experience without a second account.
- Selecting a view changes navigation and presentation only. It never grants a
  role or expands authorization.
- Every API request continues to enforce the user's stored global roles and
  active scoped assignments on the server. The backend must not trust a
  client-supplied selected role as proof of authority.

## Permission ownership

| Operation | Authorized actor |
|---|---|
| Register a new account | Public; participant role only |
| Select an available post-login view | The authenticated user |
| Grant/revoke volunteer, staff, or organizer scope | Admin or Super Admin |
| Grant/revoke global Admin | Super Admin only |
| Alter another Admin's global role | Super Admin only |
| Demote/remove/deactivate Super Admin | No application actor |

## Implementation follow-up

The current branch still needs a dedicated role-management change to enforce the
single-Super-Admin and Admin invariants and a frontend/backend role-view selector.
Those changes are intentionally separate from scoped authorization, QR security,
and event-capacity work.
