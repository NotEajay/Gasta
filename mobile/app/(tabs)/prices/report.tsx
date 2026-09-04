import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import ChipSelect from '@/components/ui/ChipSelect';
import SubPageHeader from '@/components/ui/SubPageHeader';
import FormSection from '@/components/ui/FormSection';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, type DoeRegionCode } from '@/constants/regions';
import { palette, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import {
  fetchFuelStationsByRegion,
  submitCommunityReport,
  type FuelStationOption,
} from '@/lib/services/communityReports';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';

export default function ReportPriceScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [stations, setStations] = useState<FuelStationOption[]>([]);
  const [stationId, setStationId] = useState('');
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const loadStations = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const list = await fetchFuelStationsByRegion(region);
      setStations(list);
      setStationId((prev) => (list.some((s) => s.id === prev) ? prev : (list[0]?.id ?? '')));
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    setLoading(true);
    loadStations();
  }, [loadStations]);

  const handleSubmit = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    const priceNum = parseFloat(price);
    if (!stationId || !Number.isFinite(priceNum) || priceNum <= 0) {
      Alert.alert('Invalid input', 'Pick a station and enter a valid price per liter.');
      return;
    }

    const { data: fuelRow, error: fuelError } = await supabase
      .from('fuel_types')
      .select('id')
      .eq('code', fuelType)
      .single();
    if (fuelError) {
      Alert.alert('Error', fuelError.message);
      return;
    }

    setSubmitting(true);
    try {
      await submitCommunityReport({
        stationId,
        fuelTypeId: fuelRow.id,
        price: priceNum,
        notes: notes.trim() || undefined,
      });
      Alert.alert('Submitted', 'Your report is pending community confirmation.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/prices/community') },
      ]);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState message="Loading stations…" />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to submit a community fuel price report."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  const stationOptions = stations.map((s) => ({
    value: s.id,
    label: `${s.name} (${s.oil_company.name})`,
  }));

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <SubPageHeader
        module="community"
        title="Report a Price"
        subtitle="Share what you paid. 3 confirmations makes it verified."
      />

      <FormSection title="Location" module="community">
        <ChipSelect
          label="Region"
          options={DOE_REGIONS.map((r) => ({ value: r.code, label: r.name }))}
          value={region}
          onChange={setRegion}
          module="community"
        />
        {stationOptions.length === 0 ? (
          <Text style={[styles.warn, { color: palette.warning }]}>
            No stations in this region yet.
          </Text>
        ) : (
          <ChipSelect label="Station" options={stationOptions} value={stationId} onChange={setStationId} module="community" />
        )}
      </FormSection>

      <FormSection title="Price details" module="community">
        <ChipSelect
          label="Fuel type"
          options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
          value={fuelType}
          onChange={setFuelType}
          module="community"
        />
        <LabeledInput
          label="Price you paid (₱/L)"
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 62.50"
        />
        <LabeledInput
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Cash price, promo, etc."
        />
      </FormSection>

      <PrimaryButton
        label={submitting ? 'Submitting…' : 'Submit report'}
        onPress={handleSubmit}
        disabled={submitting || stationOptions.length === 0}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  warn: { fontWeight: '600', marginBottom: spacing.sm },
});
