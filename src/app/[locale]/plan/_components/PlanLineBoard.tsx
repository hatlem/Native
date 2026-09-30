"use client";

// Search and ordering for the lines on a plan. The cards themselves stay
// server-rendered (PlanLines builds them, with their form actions) and arrive
// here as nodes; this component only decides which ones show and in what
// order. A long plan (ABAX has ~30 lines) is otherwise a scroll to find one
// title and no way to put the important ones first.
//
// - Search filters both sections as you type (title, publisher, format, note).
// - Order: drag the handle (pointer, touch or keyboard: focus, Space, arrows,
//   Space), or sort once by title / publisher / price. Every change is saved
//   (reorderListItems) and is the order the plan, /share and the desk see.
// - Dragging is off while a search is active: moving a line among a filtered
//   subset has no clear meaning for the hidden ones.

import { useEffect, useId, useMemo, useState, useTransition, type ReactNode } from "react";
import { GripVertical, Search } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { reorderListItems } from "@/app/list-actions";
import { sortLines, detectSortKey, type SortKey, type SortableLine } from "@/lib/plan-reorder";

export type PlanBoardEntry = {
  id: string;
  position: number;
  search: string;
  sort: SortableLine;
  node: ReactNode;
};

type Labels = {
  search: string;
  searchPlaceholder: string;
  showing: string; // "{shown} of {total}"
  noMatch: string;
  sortBy: string;
  sortCustom: string;
  sortTitle: string;
  sortPublisher: string;
  sortPrice: string;
  dragHandle: string;
  dragInstructions: string;
  searchBlocksDrag: string;
  saveFailed: string;
  moved: string; // "Moved to position {position} of {total}"
};

type Section = "plan" | "alternatives";

// Case- and accent-insensitive, and folds the Nordic letters NFD leaves alone,
// so "orsta" finds "Ørsta" and "baerum" finds "Bærum".
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss");
}

function matches(entry: PlanBoardEntry, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = fold(entry.search);
  return terms.every((term) => hay.includes(term));
}

const idsOf = (entries: PlanBoardEntry[]) => entries.map((e) => e.id);

export function PlanLineBoard({
  listId,
  locale,
  plan,
  alternatives,
  alternativesHeader,
  labels,
}: {
  listId: string;
  locale: string;
  plan: PlanBoardEntry[];
  alternatives: PlanBoardEntry[];
  alternativesHeader: ReactNode;
  labels: Labels;
}) {
  const [query, setQuery] = useState("");
  // The saved order may be the result of an earlier one-click sort: show that
  // sort in the select again rather than "Your order".
  const [sortKey, setSortKey] = useState<SortKey | "custom">(() =>
    detectSortKey(
      [...plan].sort((x, y) => x.position - y.position).map((e) => e.sort),
      locale,
    ),
  );
  const [planOrder, setPlanOrder] = useState(() => idsOf(plan));
  const [altOrder, setAltOrder] = useState(() => idsOf(alternatives));
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  // A server re-render (quantity, note, move to alternatives, remove) brings a
  // new set of lines: adopt the server's order whenever the set changes.
  const planKey = idsOf(plan).join(",");
  const altKey = idsOf(alternatives).join(",");
  useEffect(() => setPlanOrder(planKey ? planKey.split(",") : []), [planKey]);
  useEffect(() => setAltOrder(altKey ? altKey.split(",") : []), [altKey]);

  const byId = useMemo(() => new Map([...plan, ...alternatives].map((e) => [e.id, e])), [plan, alternatives]);
  const terms = useMemo(() => fold(query).split(/\s+/).filter(Boolean), [query]);
  const searching = terms.length > 0;

  const resolve = (order: string[]) =>
    order.map((id) => byId.get(id)).filter((e): e is PlanBoardEntry => !!e);
  const planEntries = resolve(planOrder);
  const altEntries = resolve(altOrder);
  const shownPlan = planEntries.filter((e) => matches(e, terms));
  const shownAlt = altEntries.filter((e) => matches(e, terms));
  const total = planEntries.length + altEntries.length;
  const shown = shownPlan.length + shownAlt.length;

  function persist(section: Section, itemIds: string[]) {
    setFailed(false);
    startTransition(async () => {
      const res = await reorderListItems({ listId, section, itemIds });
      if (!res.ok) {
        // The list changed elsewhere (another tab, a colleague): reload to the
        // server's truth rather than keep showing an order that wasn't saved.
        setFailed(true);
        window.location.reload();
      }
    });
  }

  function applySort(key: SortKey | "custom") {
    setSortKey(key);
    if (key === "custom") return;
    const nextPlan = sortLines(planEntries.map((e) => e.sort), key, locale);
    const nextAlt = sortLines(altEntries.map((e) => e.sort), key, locale);
    setPlanOrder(nextPlan);
    setAltOrder(nextAlt);
    persist("plan", nextPlan);
    if (nextAlt.length > 1) persist("alternatives", nextAlt);
  }

  function move(section: Section, activeId: string, overId: string) {
    const [order, setOrder] = section === "plan" ? [planOrder, setPlanOrder] : [altOrder, setAltOrder];
    const from = order.indexOf(activeId);
    const to = order.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    setSortKey("custom");
    persist(section, next);
  }

  const searchId = useId();
  const sortId = useId();

  return (
    <div className="plan-board">
      {total > 1 ? (
        <div className="plan-board__toolbar">
          <label className="plan-board__search" htmlFor={searchId}>
            <Search size={15} strokeWidth={1.8} aria-hidden="true" />
            <span className="sr-only">{labels.search}</span>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels.searchPlaceholder}
              autoComplete="off"
            />
          </label>
          <label className="plan-board__sort" htmlFor={sortId}>
            <span className="muted small">{labels.sortBy}</span>
            <select id={sortId} value={sortKey} onChange={(e) => applySort(e.target.value as SortKey | "custom")}>
              <option value="custom">{labels.sortCustom}</option>
              <option value="title">{labels.sortTitle}</option>
              <option value="publisher">{labels.sortPublisher}</option>
              <option value="price">{labels.sortPrice}</option>
            </select>
          </label>
        </div>
      ) : null}
      <p className="plan-board__status muted small" role="status" aria-live="polite">
        {searching
          ? `${labels.showing.replace("{shown}", String(shown)).replace("{total}", String(total))} · ${labels.searchBlocksDrag}`
          : failed
            ? labels.saveFailed
            : ""}
      </p>
      {searching && shown === 0 ? <p className="muted">{labels.noMatch}</p> : null}

      <SortableSection
        section="plan"
        entries={shownPlan}
        disabled={searching}
        labels={labels}
        onMove={move}
      />

      {altEntries.length > 0 && (!searching || shownAlt.length > 0) ? (
        <section className="plan-alternatives" aria-labelledby="plan-alternatives-heading">
          {alternativesHeader}
          <SortableSection
            section="alternatives"
            entries={shownAlt}
            disabled={searching}
            labels={labels}
            onMove={move}
          />
        </section>
      ) : null}
    </div>
  );
}

function SortableSection({
  section,
  entries,
  disabled,
  labels,
  onMove,
}: {
  section: Section;
  entries: PlanBoardEntry[];
  disabled: boolean;
  labels: Labels;
  onMove: (section: Section, activeId: string, overId: string) => void;
}) {
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so taps on the handle
    // (and scrolling on touch) aren't hijacked.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Stable id: dnd-kit derives aria-describedby ids from it, and a per-render
  // counter would differ between server and client (hydration mismatch).
  const dndId = useId();
  const ids = entries.map((e) => e.id);
  const total = ids.length;

  function onDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (overId === undefined || overId === event.active.id) return;
    onMove(section, String(event.active.id), String(overId));
  }

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: { draggable: labels.dragInstructions },
        announcements: {
          onDragStart: () => "",
          onDragOver: ({ over }) =>
            over ? labels.moved.replace("{position}", String(ids.indexOf(String(over.id)) + 1)).replace("{total}", String(total)) : "",
          onDragEnd: ({ over }) =>
            over ? labels.moved.replace("{position}", String(ids.indexOf(String(over.id)) + 1)).replace("{total}", String(total)) : "",
          onDragCancel: () => "",
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <div className="plan-line-list">
          {entries.map((entry) => (
            <SortableRow key={entry.id} entry={entry} disabled={disabled} handleLabel={labels.dragHandle} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  entry,
  disabled,
  handleLabel,
}: {
  entry: PlanBoardEntry;
  disabled: boolean;
  handleLabel: string;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={`plan-board__row${isDragging ? " plan-board__row--dragging" : ""}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      {disabled ? null : (
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="plan-board__handle"
          aria-label={`${handleLabel}: ${entry.sort.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
      <div className="plan-board__card">{entry.node}</div>
    </div>
  );
}
