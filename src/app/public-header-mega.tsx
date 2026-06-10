import { Link } from "@/i18n/navigation";
import { type PublicNavMega } from "@/lib/public-nav";
import { ArrowRight, Icon } from "@/app/public-header-icons";

type MegaPanelProps = {
  id: string;
  item: PublicNavMega;
  t: (key: string) => string;
  onClose: () => void;
};

export function MegaPanel({ id, item, t, onClose }: MegaPanelProps) {
  return (
    <div className="mega-panel" id={id} role="menu">
      <div className="mega-grid">
        {item.items.map((entry) => (
          <Link
            key={entry.id}
            href={entry.href}
            role="menuitem"
            className="mega-item"
            onClick={onClose}
          >
            <Icon name={entry.icon} className="mega-item-icon" />
            <span className="mega-item-text">
              <span className="mega-item-title">{t(entry.titleKey)}</span>
              <span className="mega-item-desc">{t(entry.descriptionKey)}</span>
            </span>
          </Link>
        ))}
      </div>
      <Link
        href={item.featured.href}
        role="menuitem"
        className="mega-featured"
        onClick={onClose}
      >
        <div className="mega-featured-icon">
          <Icon name={item.featured.icon} />
        </div>
        <div className="mega-featured-text">
          <div className="mega-featured-title">
            {t(item.featured.titleKey)}
            <ArrowRight />
          </div>
          <div className="mega-featured-desc">
            {t(item.featured.descriptionKey)}
          </div>
        </div>
      </Link>
    </div>
  );
}
