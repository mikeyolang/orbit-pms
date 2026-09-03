# Plan

Big request — I'll break it into three shippable pieces. All three land in one build unless you say otherwise.

## 1. Shift module (support day/night rota)

### Data (one migration)
- `shift_settings` (per org): allowed shift types, default start/end, colors, whether auto-copy from previous period is on by default.
- `shift_types` (per org): `{ id, org_id, key, label, color, start_time, end_time, is_active }` — managers can add/remove custom types.
- `shifts`: `{ id, org_id, user_id, shift_type_id, start_at, end_at, status ('scheduled'|'in_progress'|'ended'|'missed'|'swapped'), started_at, ended_at, end_comment, notes, created_by }`.
- `shift_series`: `{ id, org_id, pattern (jsonb), start_date, end_date, repeat_monthly boolean }` — rota auto-extends to next month.
- `shift_swap_requests` (see §1a).
- Add `is_support_only boolean` on `organization_members` — smaller blast radius than a new role.
- RLS: org members read shifts in their org; managers/admins/owners write; a user can `end` their own shift (`status='ended'`, `ended_at`, `end_comment`).
- GRANTs on every new table.

### UI
- New route `/app/shifts` — **calendar view** (week + month toggle). Cells show chips colored by shift type with assignee initials.
- **Drag interactions** (creative angle):
  - Drag a **member chip from the right sidebar** onto a day cell → quick-assign popover pre-filled with member + date + default type.
  - Drag an existing shift chip **between days** to reschedule; drag between users (in week/rows-by-user view) to reassign.
  - Shift+drag across days to create a **date range** in one gesture.
- **Create shift dialog**: member picker, date or range, shift type, "repeat monthly" toggle, "copy from previous week/month" button.
- **Auto shift** header buttons: "Copy previous week → this week" and "Copy previous month → this month".
- **End shift**: banner on dashboard + button on shift card → small dialog with optional comment.
- **Shift settings** at `/app/settings` new "Shifts" tab: manage types (label, color, times, active), toggle auto-copy default, allow half shifts.

### Dashboard integration
- Support-only users see a **Shift dashboard**:
  - "My current shift" card + end-shift button.
  - "Coming after me" and "Before me" cards.
  - Mini calendar preview linking to `/app/shifts`.
- Managers see a new widget: "Today's coverage" (who's on, gaps highlighted red).

### Navigation gating for support-only members
- `is_support_only = true` → sidebar shows only **Dashboard**, **Shifts**, **Tasks**. Route guards redirect blocked routes to `/app/shifts`.

### 1a. Shift swap requests (creative angle)

Table `shift_swap_requests`:
`{ id, org_id, from_shift_id, from_user_id, to_user_id nullable, to_shift_id nullable, kind ('direct'|'open'|'coverage'), reason, status ('pending'|'accepted'|'declined'|'approved'|'cancelled'|'expired'), expires_at, manager_note, decided_by, decided_at }`

Three swap modes to feel like a real support-team tool:
- **Direct swap**: pick a teammate + your shift; optionally pick one of theirs to trade. They approve/decline; manager auto-approves unless "manager approval required" is on in Shift settings.
- **Open swap ("Up for grabs")**: post your shift to a **Swap Board** on `/app/shifts` (a strip above the calendar). Any eligible teammate can claim it — first accept wins, others auto-decline.
- **Coverage request**: "I can't make it" — asks manager to reassign, no target user required. Appears in the manager's dashboard queue.

Flow niceties:
- Drag your own shift chip **onto another user's row** in the week view → prompts "Direct swap?" instead of hard-reassigning (support-only users can't reassign).
- Drag your own shift chip **onto the Swap Board strip** → posts as open swap in one gesture.
- Accepting a swap atomically updates both `shifts.user_id`s inside a Postgres function `apply_shift_swap(request_id)` (SECURITY DEFINER, checks role + status).
- Notifications row inserted into existing notifications table (reuses `/app/notifications`).
- Auto-expire: `expires_at` defaults to shift `start_at`; a periodic check (client-side on load) flips stale requests to `expired`.

RLS:
- Support users create swaps only for their own shifts.
- Targeted user can accept/decline where `to_user_id = auth.uid()` OR (kind='open' AND org member).
- Managers can approve/override any request in their org.

## 2. Inline sprint/milestone creation in New Task dialog
- Sprint and Milestone selects get a `+ Create new…` item. Clicking swaps the select for a tiny inline form (name + optional dates), creates the row, re-selects it. No modal.

## 3. Auto-slug on workspace create
- Slug field becomes `readOnly` and derived from name: `.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,"")`. Shown greyed so users see the resulting URL.

## Files touched (rough)
- **New migration**: shift tables above + swap table + `apply_shift_swap` function + `is_support_only` column + RLS + GRANTs.
- **New**: `src/routes/_authenticated/app.shifts.tsx`, `src/components/shifts/shift-calendar.tsx`, `shift-create-dialog.tsx`, `end-shift-dialog.tsx`, `shift-settings-panel.tsx`, `swap-board.tsx`, `swap-request-dialog.tsx`.
- **Edit**: `app-shell.tsx` (nav gating + shifts link), `app.index.tsx` (support dashboard branch + coverage + swap queue widget), `app.settings.tsx` (Shifts tab), `new-task-dialog.tsx` (inline create), `onboarding.tsx` (auto-slug), org members admin UI (support-only toggle).

## Not doing (unless you ask)
- SMS/email push when a shift is about to start (in-app notifications only).
- Payroll / time-tracking totals.
- Per-user timezones (workspace/browser tz).

Approve and I'll build it end-to-end.
