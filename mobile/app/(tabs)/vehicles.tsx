import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PageHero from '@/components/ui/PageHero';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SectionHeader from '@/components/ui/SectionHeader';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { palette, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  createVehicle,
  deleteVehicle,
  fetchFuelTypeIdByCode,
  fetchVehicleCatalog,
  fetchVehicles,
  updateVehicleLastRefill,
} from '@/lib/services/vehicles';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { Vehicle, VehicleCatalogEntry } from '@/types';

export default function VehiclesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [catalog, setCatalog] = useState<VehicleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('custom');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('2022');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [efficiency, setEfficiency] = useState('14');
  const [nickname, setNickname] = useState('');
  const [lastRefillPrice, setLastRefillPrice] = useState('');

  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [editLastRefillPrice, setEditLastRefillPrice] = useState('');
  const [updatingRefill, setUpdatingRefill] = useState(false);

  const load = useCallback(async () => {
    if (!user || !isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [vehicleList, catalogList] = await Promise.all([
        fetchVehicles(user.id),
        fetchVehicleCatalog(),
      ]);
      setVehicles(vehicleList);
      setCatalog(catalogList);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selectedCatalogId === 'custom') return;
    const entry = catalog.find((c) => c.id === selectedCatalogId);
    if (entry) {
      setBrand(entry.brand);
      setModel(entry.model);
      setYear(String(entry.year));
      setEfficiency(String(entry.fuel_efficiency_km_per_liter));
      if (entry.fuel_type?.code) {
        setFuelType(entry.fuel_type.code as DoeFuelTypeCode);
      }
    }
  }, [selectedCatalogId, catalog]);

  const handleAdd = async () => {
    if (!user) return;
    const yearNum = parseInt(year, 10);
    const eff = parseFloat(efficiency);
    const refill = parseFloat(lastRefillPrice);
    if (!brand || !model || !yearNum || !eff) {
      Alert.alert('Missing fields', 'Fill in brand, model, year, and efficiency.');
      return;
    }
    setSaving(true);
    try {
      const fuelTypeId = await fetchFuelTypeIdByCode(fuelType);
      if (!fuelTypeId) throw new Error('Unknown fuel type');
      await createVehicle({
        userId: user.id,
        catalogId: selectedCatalogId === 'custom' ? null : selectedCatalogId,
        brand,
        model,
        year: yearNum,
        fuelTypeId,
        fuelEfficiencyKmPerLiter: eff,
        nickname: nickname || undefined,
        lastRefillPrice: Number.isFinite(refill) && refill > 0 ? refill : undefined,
      });
      setBrand('');
      setModel('');
      setNickname('');
      setLastRefillPrice('');
      setSelectedCatalogId('custom');
      await load();
      Alert.alert('Saved', 'Vehicle added to your profile.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save vehicle');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateLastRefill = async (vehicleId: string) => {
    const price = parseFloat(editLastRefillPrice);
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert('Invalid price', 'Enter a last-refill price greater than zero.');
      return;
    }
    setUpdatingRefill(true);
    try {
      await updateVehicleLastRefill(vehicleId, price);
      setEditingVehicleId(null);
      setEditLastRefillPrice('');
      await load();
      Alert.alert('Updated', 'Last-refill price saved.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update last refill');
    } finally {
      setUpdatingRefill(false);
    }
  };

  const handleDelete = (vehicleId: string) => {
    Alert.alert('Delete vehicle', 'Remove this vehicle from your profile?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteVehicle(vehicleId);
            await load();
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete');
          }
        },
      },
    ]);
  };

  if (!isSupabaseConfigured) {
    return (
      <View style={styles.flex}>
        <SupabaseSetupBanner />
      </View>
    );
  }

  if (authLoading || loading) return <LoadingState />;

  if (!user) {
    return (
      <AuthPrompt
        message="Sign in to register and manage your vehicles."
        onSignIn={() => router.push('/login')}
      />
    );
  }

  const catalogOptions = [
    { value: 'custom' as const, label: 'Custom entry' },
    ...catalog.map((c) => ({
      value: c.id,
      label: `${c.brand} ${c.model} (${c.year})`,
    })),
  ];

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <PageHero
        module="vehicles"
        title="My Vehicles"
        subtitle="Set last-refill price so trip cost uses your real fuel spend."
      />

      <FormSection title="Add vehicle" subtitle="Pick from catalog or enter manually" module="vehicles">
        <ChipSelect
          label="From catalog"
          options={catalogOptions}
          value={selectedCatalogId}
          onChange={setSelectedCatalogId}
          module="vehicles"
        />
        <ChipSelect
          label="Fuel type"
          options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
          value={fuelType}
          onChange={setFuelType}
          module="vehicles"
        />
        <LabeledInput label="Brand" value={brand} onChangeText={setBrand} />
        <LabeledInput label="Model" value={model} onChangeText={setModel} />
        <LabeledInput label="Year" value={year} onChangeText={setYear} keyboardType="number-pad" />
        <LabeledInput
          label="Fuel efficiency (km/L)"
          value={efficiency}
          onChangeText={setEfficiency}
          keyboardType="decimal-pad"
        />
        <LabeledInput
          label="Last refill price (₱/L, optional)"
          value={lastRefillPrice}
          onChangeText={setLastRefillPrice}
          keyboardType="decimal-pad"
        />
        <LabeledInput label="Nickname (optional)" value={nickname} onChangeText={setNickname} />
        <PrimaryButton label={saving ? 'Saving…' : 'Add vehicle'} onPress={handleAdd} disabled={saving} />
      </FormSection>

      <SectionHeader title="Saved vehicles" subtitle={`${vehicles.length} registered`} module="vehicles" />
      {vehicles.length === 0 ? (
        <EmptyState
          title="No vehicles yet"
          message="Add your car above to use it in the Trip Optimizer."
        />
      ) : (
        vehicles.map((v) => (
          <Card key={v.id} elevated>
            <Text style={[styles.vehicleTitle, { color: theme.text }]}>
              {v.nickname ?? `${v.brand} ${v.model}`}
            </Text>
            <Text style={[styles.vehicleMeta, { color: theme.textSecondary }]}>
              {v.brand} {v.model} · {v.year} · {v.fuel_efficiency_km_per_liter} km/L
            </Text>
            {v.last_refill_price != null ? (
              <View style={[styles.refillRow, { backgroundColor: theme.overlay }]}>
                <Text style={[styles.refillLabel, { color: theme.textSecondary }]}>Last refill</Text>
                <Text style={[styles.refillValue, { color: theme.text }]}>
                  {formatCurrency(v.last_refill_price)}/L
                  {v.last_refill_at ? ` · ${formatDate(v.last_refill_at)}` : ''}
                </Text>
              </View>
            ) : (
              <Text style={styles.missingRefill}>No last-refill price set</Text>
            )}

            {editingVehicleId === v.id ? (
              <>
                <LabeledInput
                  label="Update last refill price (₱/L)"
                  value={editLastRefillPrice}
                  onChangeText={setEditLastRefillPrice}
                  keyboardType="decimal-pad"
                />
                <PrimaryButton
                  label={updatingRefill ? 'Saving…' : 'Save last refill'}
                  onPress={() => handleUpdateLastRefill(v.id)}
                  disabled={updatingRefill}
                  style={styles.actionBtn}
                />
                <PrimaryButton
                  label="Cancel"
                  variant="secondary"
                  onPress={() => {
                    setEditingVehicleId(null);
                    setEditLastRefillPrice('');
                  }}
                  style={styles.actionBtn}
                />
              </>
            ) : (
              <PrimaryButton
                label={v.last_refill_price != null ? 'Update last refill' : 'Set last refill'}
                variant="secondary"
                size="sm"
                onPress={() => {
                  setEditingVehicleId(v.id);
                  setEditLastRefillPrice(
                    v.last_refill_price != null ? String(v.last_refill_price) : ''
                  );
                }}
                style={styles.actionBtn}
              />
            )}

            <PrimaryButton
              label="Delete"
              variant="danger"
              size="sm"
              onPress={() => handleDelete(v.id)}
              style={styles.deleteBtn}
            />
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  vehicleTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  vehicleMeta: { fontSize: 14, marginBottom: spacing.sm },
  refillRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.sm,
  },
  refillLabel: { fontSize: 12, fontWeight: '600' },
  refillValue: { fontSize: 14, fontWeight: '700' },
  missingRefill: { color: palette.warning, fontWeight: '600', marginBottom: spacing.sm },
  actionBtn: { marginTop: spacing.sm },
  deleteBtn: { marginTop: spacing.sm },
});
