# @refarm.dev/task-calendar

Generic **iCalendar (`.ics`) → `task:v1`** expansion. It parses RFC 5545 VEVENTs (line unfolding,
`DTSTART`/`DTEND`/`DURATION`, text unescaping) into plain calendar events, and maps each event to a
`task:v1` create-input. The sibling of [`@refarm.dev/task-recurrence`](../task-recurrence): recurrence
rules and calendars are the two generic ways an operational vault generates dated tasks.

- `parseICalendar(text)` → `CalendarEvent[]` (`uid`, `summary`, `description`, `location`, `start`,
  `end`, `allDay`).
- `parseICalDuration(value)` — `PT1H30M` / `P1D` / `P1W` → milliseconds.
- `calendarEventToTask(event, opts?)` — one event → a `task:v1` create-input (title templated with
  `{summary}`/`{date}`/`{location}`, `due_at_ns` from the event start).
- `expandCalendarTasks(icsText, { now?, futureOnly?, ... })` — parse + map, optionally future-only.

All functions are **pure** (no network; no clock unless an explicit `now` is passed for
future-filtering), so parsing and expansion are deterministic and testable.

## The sovereign boundary

Distilled from an operational vault's calendar-import generator (rcdc5's `almtask`
`CalendarTaskImporter`). This package owns only the generic iCalendar parsing + the event→task shape.
The vendor layer — a UST service catalog, the estimate/description formatting, one ALM's import-CSV
columns — **stays with the consumer** as product/config. Refarm owns the generic; your vault owns the vocab.

> Timezone note: `…Z` values are UTC; a bare date-time or a `TZID`-tagged value is read as local time
> (a full tz database is out of scope). Pass pre-normalized values if you need strict tz handling.
