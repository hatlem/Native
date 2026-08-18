# Campaign cadence — how we recommend buyers plan and order for effect

Source of truth for the rules in `src/lib/programme-cadence.ts`
(`recommendCadence`). Change one, change the other. The buyer sees the
rationale as an i18n key (`plan.programme.rationale.*`) — never generated prose.

## Why programmes, not one-offs

Native content earns its effect through **repetition with variation**:

- One article is read once. Three articles over two months put the same brand
  in front of the same trade readers three times, from three angles. That is
  what moves a reader from "seen it" to "trust it" — the whole point of
  paying for editorial context instead of a banner.
- **Same core titles** across waves: recall is built by meeting the reader
  again in the place they already read. Swap in one or two new titles per
  wave for reach, but don't rebuild the list each time.
- **A fresh article every wave**: repeating the same piece wears out fast in
  a niche trade audience. Same story, new angle — the sequence we default to
  is *the problem → the proof → how it works → the comparison*.
- **Spacing 4–8 weeks**: close enough that wave 2 lands while wave 1 is still
  remembered; far enough that each piece gets its own read and the desk has
  time to book and produce it.

## The rules (`recommendCadence`)

Inputs: the plan's `goal` text and the booking units of the products on it.

| Situation | Waves | Spacing | Rationale key |
|---|---|---|---|
| Default | 3 | 6 weeks | `default` |
| Any monthly title (`bookingUnit = MONTH`) | 3 | 8 weeks (≈ every second issue) | `monthlyCycle` |
| All weekly titles | 3 | 4 weeks | `weeklyCycle` |
| Goal reads like a launch (launch / lansering / Lancierung / lanseeraus / Einführung / introduc…) | 4 | min(above, 4) | `launch` |
| Goal reads like awareness/brand (awareness / kjennskap / kännedom / kendskab / tunnettuus / Bekanntheit / brand …) | 3 | above + 2 | `awareness` |

Launch beats awareness when both match (a launch has a date, awareness
doesn't). Results are clamped onto the offered options: waves 2–4, spacing
2/4/6/8/12 weeks (ties round up — more spacing is the safer default against
wear-out).

Angle sequence: `problem, proof, howto, comparison`, cycled to the wave count.

## Wave dates

Wave 1 keeps the plan's own schedule (earliest scheduled line). Wave *k*
starts `spacing × (k−1)` weeks later, snapped to each product's grid — Monday
for weekly titles, first-of-month for monthlies (weeks are rounded to whole
months, minimum one).

## What the product does with it

- `/plan` offers "Run this as a programme" on any list with the recommended
  numbers pre-filled and editable; creating it turns the list into wave 1 and
  copies it (everything, schedule shifted) as waves 2..N, each with its angle.
- Each wave submits through the normal Request → Quote → Order chain when its
  turn comes; the wave's angle is prepended to the desk brief.
- Home shows a "next wave due" card once the previous wave is live/finished
  (or the wave's start is within 3 weeks); `/requests` labels wave rows.
- When the desk marks an order COMPLETED the buyer gets an
  `ORDER_COMPLETED` notification/email pointing at the next wave.
- A finished order's "Plan next wave" makes a full copy of the original list
  (schedule cleared) — the start of a new programme.

Deliberately not built (yet): auto-submitting later waves, a calendar view,
frequency caps, budget pacing across waves.
