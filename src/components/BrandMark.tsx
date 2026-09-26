import Svg, { Path, Rect } from 'react-native-svg';

import { APP_LOCKUP_NAME } from '@/constants/brand';
import { useAppTheme } from '@/hooks/useAppTheme';

type BrandMarkProps = {
  size?: number;
  tone?: 'default' | 'onBrand';
  accessible?: boolean;
};

export function BrandMark({
  size = 32,
  tone = 'default',
  accessible = true,
}: BrandMarkProps) {
  const { colors } = useAppTheme();
  const background = tone === 'onBrand' ? colors.onBrand : colors.brand;
  const foreground = tone === 'onBrand' ? colors.brand : colors.onBrand;

  return (
    <Svg
      accessibilityLabel={accessible ? APP_LOCKUP_NAME : undefined}
      aria-hidden={accessible ? undefined : true}
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <Rect fill={background} height={32} rx={8} width={32} x={0} y={0} />
      <Path
        d="M17.8 5.5 9.2 17.2h6.1L13.4 26.5 23.2 14h-6.2l.8-8.5Z"
        fill={foreground}
      />
    </Svg>
  );
}
