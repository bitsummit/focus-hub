import { BRAND_NAME } from '../brand';
import '../brand.css';

type BrandLogoProps = {
  size?: 'compact' | 'default' | 'large';
  iconOnly?: boolean;
  className?: string;
};

/** The only product-logo composition. Its SVG also supplies the favicon. */
export function BrandLogo({ size = 'default', iconOnly = false, className = '' }: BrandLogoProps) {
  return (
    <span
      className={`brand-logo brand-logo--${size}${iconOnly ? ' brand-logo--icon-only' : ''}${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={BRAND_NAME}
    >
      <img className="brand-symbol" src="/brand-symbol.svg" alt="" aria-hidden="true" width="35" height="35" />
      {!iconOnly && <span className="brand-word" aria-hidden="true">{BRAND_NAME.slice(0, -1)}<span className="brand-dot">{BRAND_NAME.slice(-1)}</span></span>}
    </span>
  );
}
