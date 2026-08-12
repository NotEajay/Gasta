import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { DEFAULT_MCDA_WEIGHTS } from '@/constants/mcda';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, type DoeRegionCode } from '@/constants/regions';
import { useAuth } from '@/lib/auth';
import { formatCurrency, transportModeLabel } from '@/lib/format';
import { weightsSumToOne } from '@/lib/mcda';
import { fetchFuelPriceByRegionAndType } from '@/lib/services/fuelPrices';
import { saveTripRecord } from '@/lib/services/trips';
import { fetchVehicles } from '@/lib/services/vehicles';
import { calculateTripRecommendation } from '@/lib/tripCalculator';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { MCDAWeights } from '@/types/mcda';
import type { Vehicle } from '@/types';

export default function TripOptimizerScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_95');
  const [distance, setDistance] = useState('10');
  const [efficiency, setEfficiency] = useState('14');
  const [fuelPrice, setFuelPrice] = useState<number | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | 'manual'>('manual');
  const [weights, setWeights] = useState<MCDAWeights>(DEFAULT_MCDA_WEIGHTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      if (!isSupabaseConfigured) {
        setLoading(false);
        return;
      }
      try {
        const price = await fetchFuelPriceByRegionAndType(region, fuelType);
        setFuelPrice(price);
        if (user) {
          const list = await fetchVehicles(user.id);
          setVehicles(list);
          if (list[0]) {
            setSelectedVehicleId(list[0].id);
            setEfficiency(String(list[0].fuel_efficiency_km_per_liter));
          }
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [region, fuelType, user]);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId);

  useEffect(() => {
    if (selectedVehicle) {
      setEfficiency(String(selectedVehicle.fuel_efficiency_km_per_liter));
    }
  }, [selectedVehicle]);

  const result = useMemo(() => {
    const distanceKm = parseFloat(distance);
    const fuelEfficiencyKmPerLiter = parseFloat(efficiency);
    const price = fuelPrice ?? 0;
    if (!distanceKm || distanceKm <= 0 || !price) return null;
    if (!weightsSumToOne(weights)) return null;
    return calculateTripRecommendation({
      distanceKm,
      fuelPricePerLiter: price,
      fuelEfficiencyKmPerLiter: fuelEfficiencyKmPerLiter || 1,
      weights,
    });
  }, [distance, efficiency, fuelPrice, weights]);

  const updateWeight = (key: keyof MCDAWeights, value: string) => {
    const num = parseFloat(value);
    if (Number.isNaN(num)) return;
    setWeights((prev) => ({ ...prev, [key]: num }));
  };

  const handleSave = useCallback(async () => {
    if (!user || !result?.recommended) {
      Alert.alert('Sign in required', 'Sign in to save trip records.');
      router.push('/login');
      return;
    }
    setSaving(true);
    try {
      await saveTripRecord({
        userId: user.id,
        vehicleId: selectedVehicleId === 'manual' ? null : selectedVehicleId,
        distanceKm: parseFloat(distance),
        weights,
        evaluations: result.evaluations,
        recommendedModeCode: result.recommended.modeCode,
      });
      Alert.alert('Saved', 'Trip MCDA breakdown stored.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save trip');
    } finally {
      setSaving(false);
    }
  }, [user, result, selectedVehicleId, distance, weights, router]);

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (loading) return <LoadingState message="Loading trip data…" />;

  const vehicleOptions = [
    { value: 'manual' as const, label: 'Manual entry' },
    ...vehicles.map((v) => ({
      value: v.id as string,
      label: v.nickname ?? `${v.brand} ${v.model}`,
    })),
  ];

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.padding}>
      <Text style={styles.heading}>Trip Cost Optimizer</Text>
      <Text style={styles.subheading}>
        MCDA over fuel cost, travel time, and vehicle depreciation.
      </Text>

      <ChipSelect
        label="Region (for fuel price)"
        options={DOE_REGIONS.map((r) => ({ value: r.code, label: r.name }))}
        value={region}
        onChange={setRegion}
      />
      <ChipSelect
        label="Fuel type"
        options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
        value={fuelType}
        onChange={setFuelType}
      />

      <Card>
        <Text style={styles.meta}>
          Lowest bulletin price: {fuelPrice ? formatCurrency(fuelPrice) + '/L' : 'N/A'}
        </Text>
      </Card>

      <LabeledInput
        label="Distance (km)"
        value={distance}
        onChangeText={setDistance}
        keyboardType="decimal-pad"
      />
      {user && vehicles.length > 0 && (
        <ChipSelect
          label="Your vehicle"
          options={vehicleOptions}
          value={selectedVehicleId}
          onChange={(v) => setSelectedVehicleId(v)}
        />
      )}
      <LabeledInput
        label="Fuel efficiency (km/L)"
        value={efficiency}
        onChangeText={setEfficiency}
        keyboardType="decimal-pad"
        editable={selectedVehicleId === 'manual'}
      />

      <Text style={styles.sectionTitle}>Criterion weights (must sum to 1.0)</Text>
      <LabeledInput
        label="Fuel cost weight"
        value={String(weights.fuelCost)}
        onChangeText={(v) => updateWeight('fuelCost', v)}
        keyboardType="decimal-pad"
      />
      <LabeledInput
        label="Travel time weight"
        value={String(weights.travelTime)}
        onChangeText={(v) => updateWeight('travelTime', v)}
        keyboardType="decimal-pad"
      />
      <LabeledInput
        label="Depreciation weight"
        value={String(weights.depreciation)}
        onChangeText={(v) => updateWeight('depreciation', v)}
        keyboardType="decimal-pad"
      />
      {!weightsSumToOne(weights) && (
        <Text style={styles.error}>Weights must sum to 1.0</Text>
      )}

      {result?.recommended && (
        <>
          <Card style={styles.recommended}>
            <Text style={styles.recommendedLabel}>Recommended</Text>
            <Text style={styles.recommendedMode}>
              {transportModeLabel(result.recommended.modeCode)}
            </Text>
            <Text>Score: {result.recommended.weightedScore.toFixed(3)}</Text>
          </Card>

          <Text style={styles.sectionTitle}>Full MCDA breakdown</Text>
          {result.evaluations.map((ev) => (
            <Card key={ev.modeCode}>
              <Text style={styles.modeTitle}>{transportModeLabel(ev.modeCode)}</Text>
              <Text>Fuel: {formatCurrency(ev.raw.fuelCost)}</Text>
              <Text>Time: {ev.raw.travelTime.toFixed(0)} min</Text>
              <Text>Depreciation: {formatCurrency(ev.raw.depreciation)}</Text>
              <Text style={styles.score}>Weighted score: {ev.weightedScore.toFixed(3)}</Text>
            </Card>
          ))}

          <PrimaryButton
            label={saving ? 'Saving…' : 'Save trip record'}
            onPress={handleSave}
            disabled={saving}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: 16, paddingBottom: 32 },
  heading: { fontSize: 22, fontWeight: 'bold' },
  subheading: { opacity: 0.7, marginBottom: 16, lineHeight: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginVertical: 8 },
  meta: { opacity: 0.85 },
  recommended: { backgroundColor: '#e8f8ef' },
  recommendedLabel: { fontSize: 13, opacity: 0.8 },
  recommendedMode: { fontSize: 22, fontWeight: 'bold', marginVertical: 4 },
  modeTitle: { fontWeight: '700', marginBottom: 4 },
  score: { marginTop: 4, fontWeight: '600' },
  error: { color: '#c0392b', marginBottom: 8 },
});
