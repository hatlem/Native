import { Link } from "@/i18n/navigation";
import { PUBLIC_NAV_ITEMS, type PublicNavMega } from "@/lib/public-nav";
import { ArrowRight, Icon } from "@/app/public-header-icons";

type DrawerSectionProps = {
  section: string;
  t: (key: string) => string;
  onClose: () => void;
};

export function DrawerSection({ section, t, onClose }: DrawerSectionProps) {
  const item = PUBLIC_NAV_ITEMS.find(
    (x) => x.kind === "mega" && x.id === section,
  ) as PublicNavMega | undefined;
  if (!item) return null;
  return (
    <div className="drawer-mega">
      <div className="drawer-mega-label">{t(item.labelKey)}</div>
      <nav className="drawer-mega-list" aria-label={t(item.labelKey)}>
        {item.items.map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            className="drawer-mega-item"
            onClick={onClose}
          >
            <Icon name={entry.icon} />
            <span className="drawer-mega-text">
              <span className="drawer-mega-title">{t(entry.titleKey)}</span>
              <span className="drawer-mega-desc">{t(entry.descriptionKey)}</span>
            </span>
          </Link>
        ))}
      </nav>
      <Link
        href={item.featured.href}
        className="drawer-mega-featured"
        onClick={onClose}
      >
        <div className="drawer-mega-featured-icon">
          <Icon name={item.featured.icon} />
        </div>
        <div className="drawer-mega-featured-text">
          <div className="drawer-mega-featured-title">
            {t(item.featured.titleKey)}
            <ArrowRight />
          </div>
          <div className="drawer-mega-featured-desc">
            {t(item.featured.descriptionKey)}
          </div>
        </div>
      </Link>
    </div>
  );
}
