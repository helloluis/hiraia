import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { ballBoxGeometry } from './diagram';
import type { AssessmentDiagram, AssessmentLanguage } from './types';

/** Deterministic local geometry: no downloads or image-cache dependency during an exam. */
export function AssessmentDiagramView({ diagram, language }: {
  diagram: AssessmentDiagram;
  language: AssessmentLanguage;
}) {
  const { ball, box, frontWallTop } = ballBoxGeometry(diagram.relation);
  const inside = diagram.relation === 'inside';
  const description = { en: 'A ball and a box.', tl: 'Isang bola at isang kahon.', bis: 'Usa ka bola ug usa ka kahon.' }[language];
  return (
    <View style={styles.scene} accessibilityRole="image" accessibilityLabel={description}>
      <Svg width="100%" height={156} viewBox="0 0 320 192" accessible={false}>
        <Rect x={box.x} y={box.y} width={box.width} height={box.height}
          rx={3} fill={inside ? '#F5D9A3' : '#D8A45F'} stroke="#332C26" strokeWidth={3} />
        {!inside && <>
          <Line x1={box.x + 22} y1={box.y} x2={box.x + 22} y2={box.y + box.height} stroke="#A16F36" strokeWidth={2} />
          <Line x1={box.x + box.width - 22} y1={box.y} x2={box.x + box.width - 22} y2={box.y + box.height} stroke="#A16F36" strokeWidth={2} />
        </>}
        {inside && <Path d="M92 56 L74 84 L92 100 M228 56 L246 84 L228 100" fill="#D8A45F" stroke="#332C26" strokeWidth={3} />}
        <Circle cx={ball.x} cy={ball.y} r={ball.r} fill="#407EC9" stroke="#193452" strokeWidth={3} />
        <Path d={`M${ball.x - 14} ${ball.y - 11} Q${ball.x} ${ball.y - 20} ${ball.x + 11} ${ball.y - 11}`}
          stroke="#DCEBFF" strokeWidth={3} fill="none" />
        {frontWallTop !== null && <Rect x={box.x} y={frontWallTop} width={box.width} height={box.y + box.height - frontWallTop} rx={2} fill="#D8A45F" stroke="#332C26" strokeWidth={3} />}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ scene: { width: '100%', backgroundColor: '#FFFDF7', borderRadius: 8 } });
