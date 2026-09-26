import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';

type SparklineProps = {
  values: number[];
  color: string;
  height?: number;
};

export function Sparkline({ values, color, height = 56 }: SparklineProps) {
  const points = useMemo(() => buildPoints(values, height), [values, height]);

  if (!points) {
    return null;
  }

  return (
    <View style={styles.frame}>
      <Svg
        height={height}
        preserveAspectRatio="none"
        viewBox={`0 0 320 ${height}`}
        width="100%"
      >
        <Polyline
          fill="none"
          points={points}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          vectorEffect="nonScalingStroke"
        />
      </Svg>
    </View>
  );
}

function buildPoints(values: number[], height: number): string | null {
  if (values.length < 2) {
    return null;
  }

  let min = values[0] ?? 0;
  let max = values[0] ?? 0;
  for (const value of values) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  const span = max - min || 1;
  const step = 320 / (values.length - 1);
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - 3 - ((value - min) / span) * (height - 6);
      return `${x},${y}`;
    })
    .join(' ');
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
  },
});
