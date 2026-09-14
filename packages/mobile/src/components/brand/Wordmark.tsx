import Svg, { Circle, G, Path } from 'react-native-svg';
import geometry from './brand.generated.json';

export function Wordmark({ size = 28, color = '#1C3B2E' }: { size?: number; color?: string }) {
  return <Svg width={geometry.width / 100 * size} height={.82 * size}
    viewBox={`0 0 ${geometry.width} ${geometry.height}`} accessible accessibilityLabel="hiraia">
    <Path d={geometry.wordPath} fill={color} />
    <G transform={`translate(${geometry.glyphX} 0) scale(.85)`}>
      {geometry.layers.map((d) => <Path key={d} d={d} fill="none" stroke="#BD8928" strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" />)}
      <Circle cx={20} cy={37} r={2} fill="#BD8928" />
    </G>
  </Svg>;
}
