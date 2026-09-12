# PMS Mobile App Specification

Version: 1.0 · Date: 12 September 2026 · Status: Proposed implementation brief

## 1. Purpose and product identity

Build an Android and iOS companion for the existing project management system. Staff should be able to manage assigned work, communicate within tasks, follow shifts, and submit operational reports from their phones. Managers should be able to review progress and handle permitted approvals.

The repository and README use **Orbit PMS**, while the current application interface and authentication emails use **Voltic PMS**. This specification uses **Voltic PMS** as the proposed visible mobile name to match the interface. Confirm the final name before creating store listings, app identifiers, and artwork.

The mobile app shares accounts, workspaces, projects, tasks, teams, shifts, reports, and permissions with the web application. It is a new client for the same service. This document describes a proposal; it does not mean mobile authentication, push delivery, or the new API routes already exist.

## 2. Visual direction

Use a calm, professional interface with a navy header, light page backgrounds, white cards, clear typography, and compact status badges. Carry across the web application's navy identity and restrained red navigation accent. Prioritise readable task lists and simple forms over large decorative charts.

### Colour palette

The navy `#1B3673` and header shade `#142A5C` are taken directly from the current web shell. Other hex values below are proposed mobile tokens, not exact conversions of the web application's OKLCH colours.

| Token | Light theme | Dark theme | Usage |
| --- | --- | --- | --- |
| Brand navy | `#1B3673` | `#1B3673` | Header and primary buttons with white labels |
| Deep navy | `#142A5C` | `#142A5C` | Header depth and brand surfaces |
| Page background | `#F8F9FC` | `#111827` | Main page canvas |
| Card surface | `#FFFFFF` | `#1F2937` | Cards, forms, menus |
| Main text | `#172033` | `#F9FAFB` | Titles and body text |
| Secondary text | `#596579` | `#CBD5E1` | Supporting details |
| Border | `#E2E8F0` | `#475569` | Dividers and input outlines |
| Active navigation | `#DC2626` | `#F87171` | Selected tab icon and label |
| Link / focus | `#1B3673` | `#93C5FD` | Links and visible focus indicators |
| Success | `#15803D` | `#86EFAC` | Completed work and confirmation |
| Warning | `#92400E` | `#FCD34D` | Upcoming deadlines and attention |
| Error / overdue | `#B91C1C` | `#FCA5A5` | Validation errors and overdue work |
| In progress | `#1D4ED8` | `#93C5FD` | Active task badges |
| In review | `#7E22CE` | `#D8B4FE` | Review status badges |

Use status colours as text and icons on appropriate pale or dark surfaces. Always include a status word; colour alone must not communicate state. Navigation selection also uses a visible indicator. Review contrast for final component combinations, especially navy buttons against dark cards.

### Typography and components

- Inter to match the website, with system fonts as fallback.
- Screen titles: 24–28; section titles: 18–20; body: 16; supporting labels: 13–14 logical units. Support device text scaling.
- Use an 8-unit spacing rhythm, 16-unit page padding, 12-unit card corners, and subtle borders instead of heavy shadows.
- Minimum 48-by-48 logical-unit touch areas for primary interactions.
- Label bottom navigation icons. Use familiar outline icons and initials for missing profile images.
- Use full screens for task details and long reports; use bottom sheets for short choices such as status, priority, or assignee.
- Follow the device theme by default, with Light, Dark, and System preferences.
- Respect safe areas, the on-screen keyboard, screen readers, and reduced-motion settings.

## 3. Navigation and screen layout

Default bottom navigation: **Home · My Tasks · Projects · Shifts · More**.

The header contains the workspace selector and an Inbox bell with an unread count. More contains Inbox, Shift Reports, Teams, Profile, and Settings. People & Roles appears only where permitted. Restricted modules are omitted; remaining tabs keep a consistent order. Support-only navigation must follow the existing web restrictions.

Inbox remains easy to reach from every main screen. Tasks and shifts opened from alerts return users to their previous screen when dismissed.

### Home concept

Illustrative content only:

```text
┌──────────────────────────────────┐
│ V  Voltic PMS          Inbox (3)  │
│ Operations workspace          ▾  │
├──────────────────────────────────┤
│ Good morning, Alex               │
│ Here is your work for today      │
│                                  │
│ [ 6 My tasks ] [ 2 Due today ]    │
│                                  │
│ CURRENT SHIFT                    │
│ Support · 08:00–16:00             │
│ [View handover]  [Open shift]     │
│                                  │
│ PRIORITY TASKS          View all │
│ ○ Follow up pending requests     │
│   OPS-24 · High · Due 14:00       │
│ ○ Review the daily report        │
│   OPS-31 · In review             │
│                                  │
│ RECENT UPDATES                   │
│ Sam mentioned you in OPS-24      │
├──────────────────────────────────┤
│ Home  Tasks  Projects Shifts More│
└──────────────────────────────────┘
```

Home should show the user's work first. Manager summaries and approval counts appear only when authorised. Empty sections display useful guidance, such as “No tasks due today,” rather than empty cards.

### Screen details

| Screen | Layout and behaviour |
| --- | --- |
| Welcome and sign-in | Brand mark, email and password, password visibility toggle, reset-password link, and verification guidance. Resume valid sessions automatically. |
| Workspace selection | List existing memberships and role labels. Offer permitted invitation/join flows. Keep data from different workspaces separate. |
| My Tasks | Search, Today / Upcoming / Overdue / All filters, status filters, and compact task cards. Each card shows project key, title, priority, status, assignee, and deadline where present. |
| Task details | Title and project key, editable metadata, description, subtasks, and tabs for Details and Chat & activity. A visible status control replaces drag-only interactions. |
| Task chat | Existing conversation, timestamps, mention picker, activity entries, and a composer above the keyboard. Show Sending, Sent, or Failed with retry. |
| Projects | Searchable list with project colour, name, status, and progress calculated using the agreed web rule. Open Overview, Tasks, and sprint/milestone information. |
| Shifts | Week strip above an agenda list. Open shift details, handover, and applicable check-in/check-out or swap actions. Show dates and timezone clearly. |
| Shift report | A step-by-step form with company activity, general metrics, handover notes, and a review screen before submission. |
| Inbox | Unread / All filters, readable notification cards, and links to the relevant task, shift, or report. Mark-read changes synchronise with the web Inbox. |
| Teams | Permitted team lists and member details. Keep role administration out of the first release. |
| Settings | Profile, theme, notification preferences, workspace selection, app information, and sign out. |

## 4. Features and release scope

### Release 1: daily work

| Module | Included functionality | Existing foundation / mobile work |
| --- | --- | --- |
| Account and workspace | Existing account login, verification/reset links, membership selection, session expiry handling | Better Auth and memberships exist; native session transport and app links need implementation. |
| Dashboard | My work, deadlines, current/upcoming shift, recent notifications | Existing data; mobile presentation and summary contract required. |
| Tasks | View, create, edit, assign where permitted, change status, and update subtasks | Existing task workflows; reuse permission and approval rules. |
| Projects | Browse accessible projects and their tasks; view sprint/milestone context | Existing project data; full project administration remains on web initially. |
| Chat and activity | Read/send messages, mention authorised teammates, view activity | Existing chat and live stream; mobile lifecycle and retry handling required. |
| Inbox and push | Read/mark notifications; open the linked item; receive supported event alerts | Inbox exists; device registration and push delivery are new work. |
| Shifts | View schedules and handovers; perform existing permitted check-in/check-out actions; request/respond to swaps | Existing shift workflows; adapt forms and actions for mobile. |
| Shift reports | Enter actual PMS metrics, review, submit at checkout, view report history and authorised PDFs | Existing submission/PDF routes; mobile form and safe retry behaviour required. |
| Teams | Read permitted team and member information | Existing team data. |

Retain the current task statuses: **Backlog, To do, In progress, In review, Done, Cancelled**. Retain priorities: **Low, Medium, High, Urgent**. Do not invent different mobile workflow states or let a status change bypass an existing approval requirement.

### Shift-report form: match the actual PMS

The current shift report records bus-company activity. On a phone, use searchable company cards with expandable fields instead of the website's wide table.

For each selected company, capture:

- Tickets sold and total ticket value.
- Cancelled tickets.
- Chats received, handled, and missed.

Also capture unreached clients, vouchers issued, and handover notes for the next shift. Display a total summary and the action **Check out & submit report**. Use the workspace's agreed currency; do not assume a currency from the user's device location.

The existing endpoint saves the report and ends the shift together. Mobile must preserve this combined operation. Keep the draft when submission fails and only display completion after the server confirms it. A lost response must trigger a report-status lookup before any resubmission.

### Release 2: broader management

- Manager task-approval and shift-coverage queues, following existing server rules.
- Project creation/editing and richer sprint/milestone management.
- Shift scheduling and absence coverage administration.
- People, invitations, and role administration where permitted.
- Permission-filtered search across projects and tasks.
- Offline task edits with explicit conflict resolution.
- Optional biometric local unlock after a valid account sign-in.
- File/photo attachments only after storage, access rules, and upload limits are designed; availability is not assumed from current chat.

## 5. Roles and access

Use the existing owner, admin, manager, member, and viewer roles, plus effective custom/member permission overrides. The mobile app must load effective permissions rather than infer access from a role label alone.

| User context | Intended mobile experience |
| --- | --- |
| Owner / admin | Workspace visibility and permitted operational actions; advanced administration initially available on web. |
| Manager | Accessible project/team progress and shift operations according to effective permissions. |
| Member | Assigned work, permitted project collaboration, own shift actions, and report submission. |
| Viewer | Read-only access to permitted modules. |
| Support-only membership | Restricted modules consistent with the existing web shell, including project/shift access flags. |

Respect `can_access_projects`, `can_access_shifts`, support-only restrictions, and object-level access. Hidden controls improve usability, but the server must authorise every read and write independently. Report access must follow the relevant report endpoint's rules; a dashboard reporting permission alone must not be treated as universal report access.

## 6. How the mobile app connects

### Shared architecture

```text
Web PMS ──────────────┐
                     ├── HTTPS PMS service ── PostgreSQL
Android / iOS app ────┘         │
                               ├── Authentication and permissions
                               ├── Task chat stream
                               ├── Reports and existing email workers
                               └── Proposed push delivery worker
                                          │
                                    Device notifications
```

The phone calls the PMS service over HTTPS. Database credentials, authentication secrets, email credentials, and push-provider secrets stay on the server. No direct PostgreSQL connection belongs in the app.

Use separate development, staging, and production service addresses. Production uses the actual deployed PMS HTTPS origin; the domain is not specified in this document. The mobile framework remains a technical decision to settle before scaffolding; this specification is deliberately independent of that choice. Target shared Android/iOS screens and business logic where practical.

### Existing integration points

| Current route | Purpose | Mobile consideration |
| --- | --- | --- |
| `/api/auth/*` | Better Auth account/session operations | Current web session handling is present; native compatibility must be implemented and verified. |
| `POST /api/data` | Allowlisted data operations and RPC functions | Existing web contract; avoid tightly coupling released mobile versions to generic table operations. |
| `GET /api/task-chat/stream?taskId=…` | Live task-chat events using Server-Sent Events | Authenticate, reconnect, and reload missed messages on resume. |
| `/api/task-mention-members` | Access-filtered mention candidates | Reuse its actual request contract and server-side access filtering. |
| `POST /api/shift-report` | Submit a report and check out the assigned shift | Preserve the atomic action and handle ambiguous responses. |
| `/api/shift-report/{id}/pdf` | Authorised PDF report access | Fetch with authentication; do not publish report URLs as public downloads. |
| `/api/notifications/process` and `/api/mail/process` | Server worker operations | Keep on the server; these are not mobile client calls. |

### Proposed mobile API layer

Introduce a stable `/api/mobile/v1` contract backed by the same business rules and database. Extract reusable server services where existing handlers mix transport and business logic. Do not duplicate approval, reporting, or access rules in a second backend.

Proposed resources include `/me`, `/workspaces`, `/tasks`, `/projects`, `/shifts`, `/shift-reports`, `/notifications`, and `/devices`. These routes do not exist merely because they are listed here. Final methods and payloads should be documented before client implementation.

The contract should provide cursor pagination, bounded search, explicit allowed fields, consistent error codes, server timestamps, and effective capabilities. Validate workspace and object access on every request. Return conflict information for stale edits and use idempotency keys for retryable creates, messages, and report submissions. Maintain compatibility with older supported app versions.

### Sign-in and session flow

1. User signs in with their existing PMS account through the authentication service.
2. The service applies the same email-verification requirements and validates credentials.
3. Establish a revocable native session using an authentication transport supported by the installed Better Auth version. Decide between a supported token integration or managed cookie transport during implementation; bearer-token support must not be assumed from the current configuration.
4. Store session material only in platform-protected credential storage. Keep credentials and session identifiers out of logs and ordinary preferences.
5. Load memberships, selected workspace, and effective permissions before loading its content.
6. On expired/revoked sessions, stop protected requests and return to sign-in. On sign-out, revoke the session where supported, unregister device delivery for that account, and clear protected cached data and drafts.

Verification, reset-password, invitation, and notification links should use verified HTTPS app links with a web fallback. Recheck access after sign-in and before opening the destination. Never place session credentials in deep-link URLs.

## 7. Synchronisation, notifications, and offline behaviour

The server remains authoritative. After a successful mutation, refresh affected details, lists, and dashboard counts. Refresh on app resume and pull-to-refresh. Task chat can use the existing foreground stream, but general project and shift updates must not be assumed to have live streams already.

Pause live streams when the app is backgrounded. Reconnect with backoff and refetch on return. Do not depend on a background stream to deliver notifications. Confirm the chosen production host supports the existing long-lived HTTP and PostgreSQL listener design.

For push notifications, add device registration, token rotation/removal, notification preferences, a server delivery queue, retries, and duplicate prevention. Connect supported mobile platform push services through a server adapter. Provider configuration is implementation work still to be completed.

Initial push event targets: assignments, mentions, deadline warnings, overdue tasks, shift requests/decisions, and report notifications where the user is a permitted recipient. Preserve existing recipient and deduplication rules, and define any new assignment events explicitly. Push is a prompt to refresh; it is not the data source. If users decline push permission, Inbox remains available.

Use privacy-conscious lock-screen text by default. A notification opens the exact item after authentication and permission checks, including an authorised workspace switch where required.

### Release 1 offline limits

- Allow previously loaded permitted content to be viewed with a clear “Offline · Last updated …” label, subject to an agreed cache expiry.
- Save report and message drafts locally using protected storage, scoped to account and workspace.
- Require connectivity to send messages, change tasks, approve actions, check in/out, or submit reports.
- Never show an unsent draft as submitted. Preserve it after a recoverable connection failure.
- Clear protected content on sign-out, account changes, or detected access removal. Offline access cannot instantly learn about server-side revocation; cache lifetime must be explicit.

A later offline-edit release needs an operation queue, idempotency, server revisions, and a conflict screen. Do not silently overwrite newer web edits.

## 8. Usability and reliability requirements

- Show loading placeholders, useful empty states, retryable failures, and clear permission-denied screens.
- Keep entered form content after recoverable errors. Prevent repeated taps from submitting duplicates.
- Validate counts as non-negative integers and monetary values using the server's agreed precision. Show validation near the field.
- Represent timestamps consistently; label the shift/workspace timezone and handle overnight shifts. Do not silently replace scheduled times with the device timezone.
- Display server-confirmed success. If the response is lost, reconcile before retrying consequential actions.
- Paginate long lists and fetch report PDFs only when requested.
- Allow report viewing/sharing only where permitted; explain when sharing exports a copy outside the app.
- Keep release diagnostics free of message contents, passwords, tokens, and report data.

## 9. Delivery sequence

| Stage | Concrete deliverable |
| --- | --- |
| 1. Design | Confirm product name; create light/dark screen mockups for Home, Tasks, task chat, Shifts, and report submission. |
| 2. Integration foundation | Select the mobile framework; document the versioned API; implement native sessions, permissions, environments, and verified links. |
| 3. Core app | Build workspace selection, Home, tasks, projects, and Inbox against the shared service. |
| 4. Operations | Add task chat, shifts, handover, and report submission/PDF viewing. |
| 5. Device delivery | Add push registration/delivery, protected drafts, and app lifecycle handling. |
| 6. Release preparation | Complete account/store setup, icons, privacy disclosures, build signing, and distribution configuration. |

### Completion criteria for the future implementation

An existing verified account can sign in and sees only its permitted workspaces and objects. A mobile task update appears on web and a web update appears after mobile refresh. Chat retains mention access rules. Report checkout produces one report and one shift completion even after a lost response. Notification links never bypass access restrictions. Offline drafts survive recoverable failures without appearing submitted. Light/dark screens remain readable with larger text.

This is a documentation-only change. No application builds, tests, or linting are required or performed for this specification; follow the workspace's execution constraints during subsequent implementation.

## 10. Decisions to settle before implementation

- Final public name: Voltic PMS or Orbit PMS.
- Android/iOS release order, distribution method, and mobile framework.
- Production service origin and actual hosting target; repository documentation mentions multiple deployment approaches.
- Supported native authentication transport for the installed authentication version.
- Push provider setup, event preferences, and lock-screen content policy.
- Workspace timezone/currency sources, cache expiry, and draft retention policy.

## 11. Repository references

The current-state observations above were based on these local files:

- [Web theme](../src/styles.css)
- [Application shell and branding](../src/components/app/app-shell.tsx)
- [Permission definitions](../src/lib/permissions.ts)
- [Task statuses and priorities](../src/lib/projects.ts)
- [Authentication configuration](../src/server/auth.server.ts)
- [Existing data API](../src/server/data-api.server.ts)
- [Task chat stream](../src/routes/api.task-chat.stream.ts)
- [Shift-report submission](../src/routes/api.shift-report.ts)
- [Existing checkout form](../src/components/shifts/end-shift-dialog.tsx)
- [Project README and deployment notes](../README.md)
