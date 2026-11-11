import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Start without animation until the user's preference has been resolved. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const update = () => setReduced(query.matches);
      update();
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    let active = true;
    let receivedEvent = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      receivedEvent = true;
      if (active) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && !receivedEvent) setReduced(value);
    }).catch(() => { /* Keep reduced motion on if the preference is unavailable. */ });
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}
