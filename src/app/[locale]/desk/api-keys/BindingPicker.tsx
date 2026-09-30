"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type BindingOption = {
  // The posted value createApiKey parses: "" (platform), "org:<id>", "pub:<id>".
  value: string;
  group: "platform" | "org" | "pub";
  name: string;
  // What tells two same-named entries apart: market, type, a title or site.
  detail: string;
};

// Cap on rendered matches: typing narrows ~1 900 publishers quickly, and a
// listbox of thousands of rows helps nobody.
const MAX_SHOWN = 50;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ø/g, "o")
    .replace(/æ/g, "ae");

/** The "Acts for" picker on /desk/api-keys: a searchable combobox over the
 *  platform, every organisation and every publisher. It replaced one native
 *  <select> of ~1 900 publishers where identical names ("AB", "Aller Media"
 *  ×3) couldn't be told apart and nothing could be searched. Each option
 *  carries a detail line (market, type, its titles) and the match runs on
 *  name and detail, accent-insensitive. Posts the same `binding` value the
 *  select did. */
export function BindingPicker({
  id,
  name,
  options,
}: {
  id: string;
  name: string;
  options: BindingOption[];
}) {
  const t = useTranslations("apiKeys");
  const listId = useId();
  const platform = options.find((o) => o.group === "platform")!;
  const [selected, setSelected] = useState<BindingOption>(platform);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const indexed = useMemo(
    () => options.map((o) => ({ o, hay: normalize(`${o.name} ${o.detail}`) })),
    [options],
  );
  // Every word must match (name or detail), like the catalog search.
  const hits = useMemo(() => {
    const words = normalize(query).split(/\s+/).filter(Boolean);
    return words.length
      ? indexed.filter(({ hay }) => words.every((w) => hay.includes(w))).map(({ o }) => o)
      : options;
  }, [indexed, options, query]);
  const matches = hits.slice(0, MAX_SHOWN);

  const choose = (o: BindingOption) => {
    setSelected(o);
    setQuery("");
    setOpen(false);
  };
  const groupLabel = (g: BindingOption["group"]) =>
    g === "org" ? t("bindingOrgs") : g === "pub" ? t("bindingPublishers") : t("bindingPlatformGroup");

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Enter picks the highlighted match; it never submits the form mid-search.
      if (open && matches[active]) {
        e.preventDefault();
        choose(matches[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="binding-picker">
      <input type="hidden" name={name} value={selected.value} />
      <div className="binding-picker__current" aria-live="polite">
        <span className="muted small">{groupLabel(selected.group)}</span>
        <strong>{selected.name}</strong>
        {selected.detail ? <span className="muted small">{selected.detail}</span> : null}
      </div>
      <input
        ref={inputRef}
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={t("bindingSearchPlaceholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on an option lands before the list closes.
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listId} role="listbox" className="binding-picker__list" aria-label={t("bindingLabel")}>
          {matches.length === 0 ? (
            <li className="binding-picker__empty muted small">{t("bindingNoMatch")}</li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value || "platform"}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={o.value === selected.value}
                className={`binding-picker__option${i === active ? " is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  choose(o);
                  inputRef.current?.blur();
                }}
              >
                <span className="binding-picker__group">{groupLabel(o.group)}</span>
                <span className="binding-picker__name">{o.name}</span>
                {o.detail ? <span className="binding-picker__detail">{o.detail}</span> : null}
              </li>
            ))
          )}
          {hits.length > matches.length ? (
            <li className="binding-picker__more muted small" aria-hidden="true">
              {t("bindingMore", { count: hits.length - matches.length })}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
