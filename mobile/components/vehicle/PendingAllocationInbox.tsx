import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { HomeColors } from '@/constants/home';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  fetchMyPendingAllocations,
  respondToRefillAllocation,
} from '@/lib/services/refillAllocations';
import type { PendingRefillAllocation } from '@/types';

interface Props {
  /** Called after a decision so the caller can refresh its refill lists. */
  onChanged?: () => void;
}

/**
 * Inbox of refill shares waiting on the signed-in user.
 *
 * Rendered at the top of the refill history so a pending request is impossible
 * to miss, but deliberately plain: no badge, no notification, no red dot.
 */
export default function PendingAllocationInbox({ onChanged }: Props) {
  const [items, setItems] = useState<PendingRefillAllocation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setItems(await fetchMyPendingAllocations());
      setError(null);
    } catch (e) {
      // The Phase 2 migrations are not deployed yet; stay quiet rather than
      // showing an error banner on a screen that otherwise works.
      setItems([]);
      setError(e instanceof Error ? e.message : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (item: PendingRefillAllocation, accept: boolean) => {
    setBusyId(item.allocation_id);
    try {
      await respondToRefillAllocation(item.allocation_id, accept);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save your response.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading || items.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>
        {items.length === 1
          ? '1 refill share is waiting for you'
          : `${items.length} refill shares are waiting for you`}
      </Text>

      {items.map((item) => {
        const busy = busyId === item.allocation_id;
        return (
          <View key={item.allocation_id} style={styles.card}>
            <Text style={styles.vehicle}>
              {item.brand} {item.model}
            </Text>
            <Text style={styles.meta}>Refill on {formatDate(item.occurred_at)}</Text>
            <Text style={styles.body}>
              {item.created_by_name} assigned {formatCurrency(item.amount)} of this refill
              ({formatCurrency(item.refill_total)}) to you.
            </Text>
            <View style={styles.actions}>
              <PrimaryButton
                label="Reject"
                variant="secondary"
                size="sm"
                onPress={() => respond(item, false)}
                disabled={busy}
                style={styles.action}
              />
              <PrimaryButton
                label={busy ? 'Saving…' : 'Accept'}
                size="sm"
                onPress={() => respond(item, true)}
                disabled={busy}
                style={styles.action}
              />
            </View>
          </View>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  heading: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  card: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: GasTaColors.white,
    marginBottom: spacing.sm,
  },
  vehicle: {
    color: HomeColors.navy,
    fontSize: 14,
    fontWeight: '800',
  },
  meta: {
    color: HomeColors.muted,
    fontSize: 12,
    marginTop: 1,
  },
  body: {
    color: HomeColors.navy,
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  action: { flex: 1 },
  error: {
    color: palette.danger,
    fontSize: 12,
    marginTop: spacing.xs,
  },
});
