import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SubPageHeader from '@/components/ui/SubPageHeader';
import SectionHeader from '@/components/ui/SectionHeader';
import SourceBadge from '@/components/ui/SourceBadge';
import StatCard from '@/components/ui/StatCard';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { palette, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  confirmationsLabel,
  confirmCommunityReport,
  fetchFreshVerifiedPrices,
  fetchPendingReports,
  type PendingCommunityReport,
  type VerifiedCommunityPrice,
} from '@/lib/services/communityReports';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import { Text } from '@/components/Themed';

export default function CommunityPricesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
  const [verified, setVerified] = useState<VerifiedCommunityPrice[]>([]);
  const [pending, setPending] = useState<PendingCommunityReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [v, p] = await Promise.all([
        fetchFreshVerifiedPrices(),
        fetchPendingReports(),
      ]);
      setVerified(v);
      setPending(p);
    } catch (e) {
      console.warn('Community prices load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      // Reset state and reload to ensure fresh data from database
      setVerified([]);
      setPending([]);
      void load();
    }, [load])
  );

  const handleConfirm = async (report: PendingCommunityReport) => {
    if (!user) {
      router.push('/login');
      return;
    }
    setConfirmingId(report.id);
    try {
      await confirmCommunityReport(report.id);
      Alert.alert(
        'Confirmed',
        report.confirmation_count + 1 >= VERIFY_CONFIRMATIONS_REQUIRED
          ? 'Report is now verified for display.'
          : confirmationsLabel(report.confirmation_count + 1)
      );
      await load();
    } catch (e) {
      Alert.alert('Could not confirm', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setConfirmingId(null);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState message="Loading community prices…" />;

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={palette.primary}
        />
      }>
      <SubPageHeader
        module="community"
        title="Community Prices"
        subtitle={`Verified by ${VERIFY_CONFIRMATIONS_REQUIRED} users within ±₱0.50/L`}
      />

      <SectionHeader title="Verified" subtitle="Fresh for 7 days" module="community" />
      {verified.length === 0 ? (
        <EmptyState
          title="No verified prices yet"
          message="Report a price you saw, then ask others to confirm it at the station."
        />
      ) : (
        verified.map((row) => (
          <StatCard
            key={row.report_id}
            variant="success"
            module="community"
            label={row.station_name}
            value={`${formatCurrency(row.reported_price)}/L`}
            meta={`Verified ${formatDate(row.verified_at)}`}
          />
        ))
      )}

      <SectionHeader
        title="Needs confirmation"
        subtitle={user ? 'Tap confirm if you saw this price' : 'Sign in to help verify'}
        module="community"
      />
      {!user ? (
        <AuthPrompt
          message="Sign in to confirm community price reports."
          onSignIn={() => router.push('/login')}
        />
      ) : pending.length === 0 ? (
        <EmptyState title="All caught up" message="No pending reports waiting for confirmation." />
      ) : (
        pending.map((report) => (
          <Card key={report.id} elevated>
            <Text style={[styles.station, { color: theme.text }]}>
              {report.station?.name ?? 'Station'}
            </Text>
            <Text style={[styles.price, { color: theme.text }]}>
              {report.fuel_type?.name ?? 'Fuel'} · {formatCurrency(report.reported_price)}/L
            </Text>
            <View style={[styles.confirmRow, { backgroundColor: theme.overlay }]}>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                Unverified · {confirmationsLabel(report.confirmation_count)}
              </Text>
              <Text style={[styles.meta, { color: theme.textSecondary }]}>
                {formatDate(report.created_at)}
              </Text>
            </View>
            <PrimaryButton
              label={confirmingId === report.id ? 'Confirming…' : 'I saw this price'}
              variant="secondary"
              onPress={() => handleConfirm(report)}
              disabled={confirmingId === report.id}
              style={styles.btn}
            />
          </Card>
        ))
      )}

      <PrimaryButton
        label="Report a price"
        onPress={() => router.push('/(tabs)/prices/report')}
        style={styles.reportBtn}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  station: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  price: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3, marginBottom: spacing.sm },
  confirmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  meta: { fontSize: 13, fontWeight: '500' },
  btn: { marginTop: spacing.xs },
  reportBtn: { marginTop: spacing.lg },
});
