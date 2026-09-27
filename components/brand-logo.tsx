import Image from 'next/image';

type BrandLogoProps = {
  size?: number;
  className?: string;
  priority?: boolean;
};

/** The single approved Nexus Rescue mark used across the application. */
export function BrandLogo({ size = 40, className, priority = false }: BrandLogoProps) {
  return (
    <Image
      src="/brand-logo.png"
      alt=""
      width={size}
      height={size}
      sizes={`${size}px`}
      priority={priority}
      className={className}
      style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
