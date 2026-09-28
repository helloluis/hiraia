import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { Animated, AppState, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Language } from '@hiraia/shared';
import { ACTIVE_MODEL, REMOTE_ASSETS } from '../config/model';
import { readMemory } from '../engine/memory';
import { semanticMemoryBlock } from '../engine/memoryPolicy';
import {
  assetDownloadStatus,
  inspectAssetDownload,
  subscribeAssetDownloads,
  type AssetDownloadStatus,
} from '../engine/modelDownload';
import { modelDownloadPreference, subscribeModelDownloadPreference } from '../engine/modelDownloadControl';
import {
  semanticPrefetchStatus,
  semanticRowState,
  subscribeSemanticPrefetch,
  type SemanticRowState,
} from '../engine/semanticPrefetch';
import { useAssetUpdateStore } from '../store/assetUpdateStore';
import { useEngineStore } from '../store/engineStore';
import { installedModelUpdate } from '../updates/model';
import type { ModelUpdate } from '../updates/catalog';
import { card, fonts } from '../theme';
import { useReduceMotion } from './cards/useReduceMotion';

const copy = {
  english: {
    checking: 'Checking download…',
    missing: 'Not downloaded',
    paused: 'Download paused',
    downloading: 'Downloading',
    retrying: 'Retrying connection…',
    verifying: 'Verifying download…',
    downloaded: 'Downloaded · available offline',
    failed: 'Download unavailable · check connection and storage',
    restart: 'Model update · ready for next app launch',
    searchLabel: 'Search',
    ready: 'Ready · available offline',
    unsupported: 'Not available on this phone',
  },
  tagalog: {
    checking: 'Sinusuri ang download…',
    missing: 'Hindi pa na-download',
    paused: 'Naka-pause ang download',
    downloading: 'Dina-download',
    retrying: 'Sinusubukang kumonekta muli…',
    verifying: 'Bineberipika ang download…',
    downloaded: 'Na-download na · magagamit offline',
    failed: 'Hindi makumpleto ang download · suriin ang koneksiyon at storage',
    restart: 'Bagong modelo · handa sa susunod na pagbukas ng app',
    searchLabel: 'Paghahanap',
    ready: 'Handa na · magagamit offline',
    unsupported: 'Hindi magagamit sa teleponong ito',
  },
  cebuano: {
    checking: 'Gisusi ang download…',
    missing: 'Wala pa ma-download',
    paused: 'Naka-pause ang download',
    downloading: 'Gi-download',
    retrying: 'Gisulayang mokonekta pag-usab…',
    verifying: 'Gipamatud-an ang download…',
    downloaded: 'Na-download na · magamit offline',
    failed: 'Dili makompleto ang download · susiha ang koneksiyon ug storage',
    restart: 'Bag-ong modelo · andam sa sunod nga pag-abli sa app',
    searchLabel: 'Pagpangita',
    ready: 'Andam na · magamit offline',
    unsupported: 'Dili magamit niining telepono',
  },
};

function DownloadIcon({ phase }: { phase: AssetDownloadStatus['phase'] | 'unsupported' }) {
  const rotation = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const spinning = phase === 'downloading' || phase === 'verifying';
  useEffect(() => {
    rotation.setValue(0);
    if (!spinning || reduceMotion) return;
    const animation = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
        isInteraction: false,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [rotation, spinning, reduceMotion]);
  const path =
    phase === 'unsupported'
      ? 'M6 12h12'
      : phase === 'downloaded'
        ? 'M5 12l4 4L19 6'
        : spinning || phase === 'retrying'
          ? 'M20 7v5h-5 M20 12a8 8 0 1 0-2 5'
          : phase === 'failed'
            ? 'M12 4v10 M12 18v2'
            : phase === 'paused'
              ? 'M8 5v14 M16 5v14'
              : 'M12 3v12 M7 10l5 5 5-5 M5 18v3h14v-3';
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        transform: [
          { rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
        ],
      }}
    >
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
        <Path
          d={path}
          stroke={card.ink}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  );
}

/**
 * The AI files this phone has: the tutor LLM, then LaBSE search. The LLM row is left out on a
 * phone that can never run the LLM (a 4 GB JP1): "Not downloaded" there reads as a fault that
 * no wait will fix. LaBSE is what such a phone downloads, so its row always shows.
 */
export function ModelDownloadStatus({ language, label }: { language: Language; label: string }) {
  const llmUnsupported = useEngineStore((s) => s.launchMemoryBlock) === 'unsupported';
  return (
    <>
      {llmUnsupported ? null : <TutorModelStatus language={language} label={label} />}
      <SearchModelStatus language={language} />
    </>
  );
}

/** LLM file availability, independent of image packs and of engine warm-up. */
function TutorModelStatus({ language, label }: { language: Language; label: string }) {
  const [installed, setInstalled] = useState<ModelUpdate | null>(null);
  const [resolved, setResolved] = useState(false);
  const update = useAssetUpdateStore((s) => s.model);
  const updateStatus = useAssetUpdateStore((s) => s.status);
  // Show a replacement being fetched too; merely offering one does not hide the
  // installed model's checkmark. A staged replacement is labelled for next launch.
  const staged =
    update && ['downloading', 'ready', 'failed'].includes(updateStatus) ? update : null;
  const spec = staged ?? installed ?? REMOTE_ASSETS.base;
  const status = useSyncExternalStore(subscribeAssetDownloads, () =>
    assetDownloadStatus(spec.filename)
  );
  useFocusEffect(
    useCallback(() => {
      let live = true;
      const refresh = async () => {
        const selected = await installedModelUpdate();
        if (!live) return;
        setInstalled(selected);
        setResolved(true);
        await inspectAssetDownload(staged ?? selected ?? REMOTE_ASSETS.base);
      };
      void refresh();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => {
        live = false;
        sub.remove();
      };
    }, [staged, updateStatus])
  );
  const phase = resolved ? status.phase : 'checking';
  const t = copy[language];
  const version = staged ?? installed;
  const baseVersion = REMOTE_ASSETS.base.filename.match(/-(v\d+)\./)?.[1];
  const title = version
    ? `${version.label} · r${version.revision}`
    : `${ACTIVE_MODEL.displayName}${baseVersion ? ` · ${baseVersion}` : ''} · ${ACTIVE_MODEL.quant}`;
  const detail =
    staged && phase === 'downloaded' && updateStatus === 'ready'
      ? t.restart
      : `${t[phase]}${phase === 'downloading' || (phase === 'paused' && status.percent > 0) ? ` · ${status.percent}%` : ''}`;
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.value}>
          <Text style={styles.title}>{title}</Text>
          <DownloadIcon phase={phase} />
        </View>
      </View>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const SEARCH_FILES = [REMOTE_ASSETS.embedder, REMOTE_ASSETS.vectors];
const searchIcon: Record<SemanticRowState, AssetDownloadStatus['phase'] | 'unsupported'> = {
  unsupported: 'unsupported',
  ready: 'downloaded',
  downloaded: 'downloaded',
  downloading: 'downloading',
  verifying: 'verifying',
  retrying: 'retrying',
  paused: 'paused',
  waiting: 'retrying',
  failed: 'failed',
  checking: 'checking',
  missing: 'missing',
};

/**
 * LaBSE search (embedder + fact vectors, fetched by engine/semanticPrefetch.ts): one row for
 * the pair, with a size-weighted percent — the pair is useless until both files land.
 */
function SearchModelStatus({ language }: { language: Language }) {
  const embedder = useSyncExternalStore(subscribeAssetDownloads, () =>
    assetDownloadStatus(REMOTE_ASSETS.embedder.filename)
  );
  const vectors = useSyncExternalStore(subscribeAssetDownloads, () =>
    assetDownloadStatus(REMOTE_ASSETS.vectors.filename)
  );
  const prefetch = useSyncExternalStore(subscribeSemanticPrefetch, semanticPrefetchStatus);
  const downloads = useSyncExternalStore(subscribeModelDownloadPreference, modelDownloadPreference);
  const engineSemantic = useEngineStore((s) => s.semanticReady);
  const [unsupported, setUnsupported] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      const refresh = async () => {
        // Read here as well as by the prefetcher, so a sidebar opened before its first
        // attempt (a few seconds after launch) already knows a phone that cannot hold LaBSE.
        const memory = await readMemory();
        if (live) setUnsupported(semanticMemoryBlock(memory) === 'unsupported');
        await Promise.all(SEARCH_FILES.map((spec) => inspectAssetDownload(spec)));
      };
      void refresh();
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') void refresh();
      });
      return () => {
        live = false;
        sub.remove();
      };
    }, [])
  );
  const { state, percent } = semanticRowState({
    prefetch,
    unsupported,
    engineSemantic,
    downloadsEnabled: downloads.enabled,
    files: [
      { status: embedder, bytes: REMOTE_ASSETS.embedder.bytes },
      { status: vectors, bytes: REMOTE_ASSETS.vectors.bytes },
    ],
  });
  const t = copy[language];
  const showPercent =
    state === 'downloading' || ((state === 'paused' || state === 'waiting') && percent > 0);
  // Between attempts after a failed download the prefetcher retries on its own, on ANY network
  // (and at once when one returns), so this is the "retrying" line, not a claim about Wi-Fi.
  const line = t[state === 'waiting' ? 'retrying' : state];
  return (
    <View style={styles.block}>
      <View style={styles.row}>
        <Text style={styles.label}>{t.searchLabel}</Text>
        <View style={styles.value}>
          <Text style={styles.title}>LaBSE</Text>
          <DownloadIcon phase={searchIcon[state]} />
        </View>
      </View>
      <Text style={styles.detail}>{`${line}${showPercent ? ` · ${percent}%` : ''}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 4, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { fontFamily: fonts.cardBody, fontSize: 15, color: card.olive },
  value: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  title: {
    fontFamily: fonts.cardBody,
    fontSize: 15,
    color: card.ink,
    flexShrink: 1,
    textAlign: 'right',
  },
  detail: { fontFamily: fonts.cardBody, fontSize: 13, color: card.olive, textAlign: 'right' },
});
