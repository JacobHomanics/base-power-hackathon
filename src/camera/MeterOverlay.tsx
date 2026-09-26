import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Mask, Path, Rect } from 'react-native-svg';

type MeterLayout = {
  cx: number;
  cy: number;
  r: number;
  boxLeft: number;
  boxTop: number;
  boxWidth: number;
  boxHeight: number;
  basePath: string;
  stroke: number;
};

function layoutMeter(width: number, height: number, scale: number): MeterLayout | null {
  if (width < 48 || height < 48) return null;

  const pad = 16;
  const r = Math.min(width * 0.27, (height - pad * 2) / 2.85, 150) * scale;
  if (r < 18) return null;

  const cx = width / 2;
  const boxTopOffset = -0.42 * r;
  const boxHeight = 2.15 * r;
  const minCy = pad + r;
  const maxCy = height - pad - boxTopOffset - boxHeight;
  const cy = Math.min(Math.max(height * 0.4, minCy), Math.max(minCy, maxCy));
  const boxTop = cy + boxTopOffset;
  const boxHalf = r * 1.2;
  const boxLeft = cx - boxHalf;
  const dy = boxTop - cy;
  const intersect = Math.sqrt(Math.max(0, r * r - dy * dy));
  const leftHit = cx - intersect;
  const rightHit = cx + intersect;
  const boxRight = cx + boxHalf;
  const boxBottom = boxTop + boxHeight;
  const basePath = [
    `M ${leftHit} ${boxTop}`,
    `H ${boxLeft}`,
    `V ${boxBottom}`,
    `H ${boxRight}`,
    `V ${boxTop}`,
    `H ${rightHit}`,
  ].join(' ');

  return {
    cx,
    cy,
    r,
    boxLeft,
    boxTop,
    boxWidth: boxHalf * 2,
    boxHeight,
    basePath,
    stroke: Math.min(3.5, Math.max(2.5, r * 0.028)),
  };
}

export function MeterOverlay({ scale = 1 }: { scale?: number }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const layout = layoutMeter(size.width, size.height, scale);

  return (
    <View
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }}
      style={styles.frame}
    >
      {layout ? (
        <Svg
          accessible={false}
          height={size.height}
          pointerEvents="none"
          width={size.width}
        >
          <Defs>
            <Mask
              height={size.height}
              id="meterGuide"
              maskContentUnits="userSpaceOnUse"
              maskUnits="userSpaceOnUse"
              width={size.width}
              x={0}
              y={0}
            >
              <Rect fill="#ffffff" height={size.height} width={size.width} x={0} y={0} />
              <Circle cx={layout.cx} cy={layout.cy} fill="#000000" r={layout.r} />
              <Rect
                fill="#000000"
                height={layout.boxHeight}
                width={layout.boxWidth}
                x={layout.boxLeft}
                y={layout.boxTop}
              />
            </Mask>
          </Defs>
          <Rect
            fill="#000000"
            height={size.height}
            mask="url(#meterGuide)"
            opacity={0.5}
            width={size.width}
            x={0}
            y={0}
          />
          <Path
            d={layout.basePath}
            fill="none"
            stroke="rgba(0, 0, 0, 0.7)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={layout.stroke + 3}
          />
          <Circle
            cx={layout.cx}
            cy={layout.cy}
            fill="none"
            r={layout.r}
            stroke="rgba(0, 0, 0, 0.7)"
            strokeWidth={layout.stroke + 3}
          />
          <Path
            d={layout.basePath}
            fill="none"
            stroke="#ffffff"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={layout.stroke}
          />
          <Circle
            cx={layout.cx}
            cy={layout.cy}
            fill="none"
            r={layout.r}
            stroke="#ffffff"
            strokeWidth={layout.stroke}
          />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flex: 1,
  },
});
