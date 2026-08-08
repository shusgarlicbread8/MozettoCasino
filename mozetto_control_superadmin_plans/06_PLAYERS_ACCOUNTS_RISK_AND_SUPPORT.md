# Mozetto Control — Players, Accounts, Risk and Support

## 1. Goal

One place to understand a player without exposing information that compromises poker fairness.

---

## 2. Search and identity

Search by:

```text
wallet
ArenaAccount
profile id
display name
session id
table id
transaction hash
```

Identity panel:

```text
wallet
ArenaAccount
profile kind
created at
last active
rating
account flags
GamePermission state
active sessions
```

---

## 3. Money panel

Read-only:

```text
available
at tables
settling
lifetime deposits
lifetime withdrawals
lifetime poker P&L
rake contributed
```

Every money number should identify whether it is:

- on-chain authoritative;
- indexer projection;
- DB mirror;
- calculated reporting value.

---

## 4. Poker behavior

Show:

```text
hands
sessions
VPIP/PFR/3bet where available
aggression score
rating history
city/stake distribution
profile usage
bust/top-up frequency
sit-out frequency
leave frequency
```

Useful for both support and abuse review.

---

## 5. Integrity panel

Surface existing risk signals:

- repeated opponents;
- pair-cap hits;
- linked-account edges;
- suspicious synchronized seating;
- unusual transfer/funding relationships if those signals exist;
- rat-hole attempts;
- abnormal disconnect patterns;
- rating-farming signals;
- review status.

Do not label a player as a cheater from a single heuristic. Use:

```text
SIGNAL
REVIEW_REQUIRED
RESTRICTED
CLEARED
```

with evidence.

---

## 6. Fairness boundary

Admins should **not** see live unrevealed hole cards.

Even a superadmin should not have a privileged live spectator view that could be abused for collusion.

Display only:

- cards legitimately visible to that player's own session if the operator is acting in a support-replay context after appropriate authorization;
- publicly revealed showdown cards;
- post-hand verifier artifacts where allowed.

Default Control behavior: no private live card visibility.

---

## 7. Safe support controls

Allowed examples:

### `RESTRICT_NEW_MATCHMAKING`

Prevents new ranked allocations after current session boundaries.

### `MARK_UNDER_REVIEW`

No direct financial effect.

### `REQUEST_REPLAY`

Runs replay verification and attaches result.

### `REQUIRE_INTEGRITY_REVIEW`

Routes future ranked-entry attempt to review policy if product supports it.

### `CLEAR_REVIEW`

Requires reason and audit.

Not allowed:

```text
force fold player
edit stack
reverse poker loss manually
change cards
change rating without governed correction procedure
```

---

## 8. Responsible play / account safety

If Mozetto ships real-money play, Control should display user-enforced safety states such as:

- self-exclusion;
- deposit/session caps;
- cooling-off;
- country/eligibility status if applicable;
- account lock.

Admin UX must respect user-originated restrictions and never silently bypass them.

---

## 9. Player detail timeline

Combine:

```text
auth events
funding events
GamePermission changes
match allocations
session joins/leaves
top-ups
settlements
rating updates
risk flags
admin actions
```

Use one timestamped timeline with source labels.

---

## 10. API

```http
GET /v1/admin/players
GET /v1/admin/players/:id
GET /v1/admin/players/:id/sessions
GET /v1/admin/players/:id/money
GET /v1/admin/players/:id/integrity
GET /v1/admin/players/:id/admin-history
POST /v1/admin/players/:id/restrictions
POST /v1/admin/players/:id/request-replay
```

Every POST requires reason and capability.
