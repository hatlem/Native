"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

type Ctx = {
  enabled: boolean;
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
  clear: () => void;
};

const CompareCtx = createContext<Ctx | null>(null);

const STORAGE_KEY = "catalog.compareSelection";
const MAX_SELECTED = 6;

export function CompareSelectionProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // Hydrate from localStorage so the selection survives navigation.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw) as string[];
      if (Array.isArray(ids)) setSelected(new Set(ids));
    } catch {
      // ignore corrupted storage
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(selected)),
      );
    } catch {
      // ignore quota errors
    }
  }, [selected]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_SELECTED) {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo<Ctx>(
    () => ({ enabled, selected, toggle, clear }),
    [enabled, selected, toggle, clear],
  );

  return (
    <CompareCtx.Provider value={value}>
      {children}
      {enabled ? <CompareBar /> : null}
    </CompareCtx.Provider>
  );
}

function useCompare(): Ctx {
  const ctx = useContext(CompareCtx);
  if (!ctx) throw new Error("useCompare must be used inside CompareSelectionProvider");
  return ctx;
}

export function TitleSelector({ id }: { id: string }) {
  const { enabled, selected, toggle } = useCompare();
  if (!enabled) return null;
  const checked = selected.has(id);
  return (
    <label
      className="title-selector"
      aria-label="Select for compare"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={() => toggle(id)}
      />
    </label>
  );
}

function CompareBar() {
  const { selected, clear } = useCompare();
  const t = useTranslations("catalog.compareBar");
  const router = useRouter();
  const count = selected.size;
  if (count < 2) return null;
  const href = `/catalog/compare?ids=${Array.from(selected).join(",")}`;
  return (
    <div className="compare-bar" role="region" aria-label="Compare selection">
      <div className="compare-bar__inner">
        <span className="compare-bar__count">{t("label", { count })}</span>
        <div className="compare-bar__actions">
          <button
            type="button"
            className="compare-bar__clear"
            onClick={clear}
          >
            {t("clear")}
          </button>
          <button
            type="button"
            className="compare-bar__open"
            onClick={() => router.push(href)}
          >
            {t("open")}
          </button>
        </div>
      </div>
    </div>
  );
}
