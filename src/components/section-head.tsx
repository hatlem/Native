import type { ReactNode } from "react";

type Props = {
  eyebrow?: ReactNode;
  title: ReactNode;
  trailing?: ReactNode;
};

// Section heading row. Optional eyebrow above the h2, optional trailing
// slot (count, link, CTA button) right-aligned on desktop and wrapping
// underneath on mobile.
export function SectionHead({ eyebrow, title, trailing }: Props) {
  return (
    <div className="section-head">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h2>{title}</h2>
      </div>
      {trailing}
    </div>
  );
}
