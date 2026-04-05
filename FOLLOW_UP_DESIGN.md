# Proactive Action Loop: Designing the Follow-Up UX

## 1. The Core Problem Statement
Currently, the `nextFollowUpAt` property functions as an immutable ledger rather than an actionable CRM mechanic. While users can effectively set a follow-up date via the Natural Language Processing (NLP) input in the Rich Interaction Composer, the date is rendered **exclusively within the individual Contact Profile** as static text.

From a Human-Computer Interaction (HCI) perspective, this creates a **"UX Black Hole."** 
A reminder system that requires the user to proactively recall *who* they set the reminder for completely defeats its core utility. The application is acting as a passive data repository (a "rolodex") rather than a proactive relationship manager. 

## 2. HCI & UI Philosophy
A modern CRM should be an assistant that taps you on the shoulder. To achieve this, we must adhere to the principle of **Ambient Awareness**: tasks and deadlines must be visible without context switching or active querying.

The design philosophy for surfacing `nextFollowUpAt` relies on three pillars:
1. **Interruptive vs. Ambient:** Overdue tasks should interrupt the default state (Dashboard), while pending tasks should remain ambient (Sidebar/List icons).
2. **Immediate Affordance:** Seeing a reminder must immediately offer a path to resolution (e.g., clicking a reminder auto-opens the composer to log the resolution).
3. **Graceful Deferral:** Users must be able to push back (Snooze) tasks without navigating deep into a profile to manually edit a date string.

---

## 3. Recommended Feature Architecture

### A. The Dashboard "Action Center" (High Priority)
Users need to know what they must accomplish the moment they log in.
- **Implementation:** Introduce an **"Up Next"** horizontal scroll rail at the very top of the `/dashboard` routing view. 
- **The UI:** Contacts with a `nextFollowUpAt` of today or earlier render as elevated "Action Cards." Each card displays the contact's avatar, company, and a prominent urgency badge (e.g., `⚠️ Overdue` or `📅 Today`). 
- **The Affordance:** Clicking the card immediately summons the `FloatingContactCard` so the user can email or call them and log the interaction without leaving the dashboard context.

### B. The Universal Sidebar Pulse (Ambient Awareness)
Users require situational awareness of pending tasks while navigating elsewhere in the system.
- **Implementation:** Add a dedicated "Action Items" (or "Follow-ups") icon to the main left navigation sidebar.
- **The UI:** Retrieve a count of `nextFollowUpAt <= NOW()` and attach a dynamic, primary-colored numerical notification badge (e.g., `[ 3 ]`) directly to the icon. This creates persistent, respectful urgency.

### C. In-List Triage Indicators (Network View)
When sweeping the global alphabetical or recent lists, impending follow-ups should naturally draw the eye.
- **Implementation:** In the standard `slim` list view.
- **The UI:** Integrate a glowing `CalendarClock` icon accompanied by a subtle amber notification dot next to the names of contacts who require attention.
- **Extension:** Add a simple "Sort by: Needs Attention" toggle to the global search/filter bar to surface these contacts programmatically.

### D. Interactive "Snooze or Clear" Affordance
The static display of a date inside the profile provides no interaction value.
- **Implementation:** Augment the `ContactProfile` header. 
- **The UI:** When a date is approaching or overdue, the static text morphs into a highly visible, interactive Banner (e.g., `⚠️ Follow-up due today`).
- **The Affordance:** Attach two quick-action buttons to the banner:
  1. **[ Log Interaction ]** (Auto-focuses the timeline composer).
  2. **[ Snooze 1 week ]** (Optimistically bumps the `nextFollowUpAt` date forward by 7 days in the database via a quick API call).

---

## 4. API & Data Architectural Requisites
Currently, saving a follow-up inside the interaction composer results in two separate API calls:
1. `POST /api/interactions`
2. `PUT /api/contacts/:id`

To support rigorous UI features like Snoozing and exact dashboard counts, we recommend refactoring this into a **Composite API Endpoint**. The frontend should send a single unified payload to a route like `POST /api/interactions/log`, which opens a strict SQLite transaction to append the timeline and update the Contact's global `nextFollowUpAt` state simultaneously. This perfectly guarantees data integrity and prevents UI/State divergence.
