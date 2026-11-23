import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, native } from './theme';

/** A bottom sheet that slides up over a fading scrim. Stays mounted while it slides away. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const t = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(t, {
      toValue: open ? 1 : 0,
      duration: open ? 300 : 200,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: native,
    }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, t]);

  if (!mounted) return null;
  const translateY = t.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: t }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY }] }]}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text style={styles.title}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>
        <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
          {children}
        </ScrollView>
        {footer ? <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>{footer}</View> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: 'rgba(5,2,12,0.6)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '78%',
    backgroundColor: C.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: C.line,
  },
  handle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { flex: 1, color: C.text, fontSize: 20, fontWeight: '800' },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.panel2, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: C.muted, fontSize: 14, fontWeight: '700' },
});
