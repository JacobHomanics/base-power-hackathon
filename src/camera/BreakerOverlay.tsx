import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

type BreakerLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  stroke: number;
};

function layoutBreaker(width: number, height: number, scale: number): BreakerLayout | null {
  if (width < 48 || height < 48) return null;

  const pad = 16;
  const maxWidth = width - pad * 2;
  const maxHeight = height - pad * 2;
  let boxHeight = Math.min(maxHeight * 0.92, 560);
  let boxWidth = boxHeight * 0.58;
  if (boxWidth > maxWidth) {
    boxWidth = maxWidth;
    boxHeight = boxWidth / 0.58;
  }
  boxWidth *= scale;
  boxHeight *= scale;
  if (boxWidth < 36 || boxHeight < 60) return null;

  return {
    x: (width - boxWidth) / 2,
    y: (height - boxHeight) / 2,
    width: boxWidth,
    height: boxHeight,
    radius: Math.min(16, boxWidth * 0.045),
    stroke: Math.min(3.5, Math.max(2.5, boxWidth * 0.012)),
  };
}

export function BreakerOverlay({ scale = 1 }: { scale?: number }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const layout = layoutBreaker(size.width, size.height, scale);

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
        <Svg accessible={false} height={size.height} pointerEvents="none" width={size.width}>
          <Defs>
            <Mask
              height={size.height}
              id="breakerGuide"
              maskContentUnits="userSpaceOnUse"
              maskUnits="userSpaceOnUse"
              width={size.width}
              x={0}
              y={0}
            >
              <Rect fill="#ffffff" height={size.height} width={size.width} x={0} y={0} />
              <Rect
                fill="#000000"
                height={layout.height}
                rx={layout.radius}
                ry={layout.radius}
                width={layout.width}
                x={layout.x}
                y={layout.y}
              />
            </Mask>
          </Defs>
          <Rect
            fill="#000000"
            height={size.height}
            mask="url(#breakerGuide)"
            opacity={0.5}
            width={size.width}
            x={0}
            y={0}
          />
          <Rect
            fill="none"
            height={layout.height}
            rx={layout.radius}
            ry={layout.radius}
            stroke="rgba(0, 0, 0, 0.7)"
            strokeWidth={layout.stroke + 3}
            width={layout.width}
            x={layout.x}
            y={layout.y}
          />
          <Rect
            fill="none"
            height={layout.height}
            rx={layout.radius}
            ry={layout.radius}
            stroke="#ffffff"
            strokeWidth={layout.stroke}
            width={layout.width}
            x={layout.x}
            y={layout.y}
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
