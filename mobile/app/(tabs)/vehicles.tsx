import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { useAuth } from '@/lib/auth';
import {
  createVehicle,
  deleteVehicle,
  fetchFuelTypeIdByCode,
  fetchVehicleCatalog,
  fetchVehicles,
} from '@/lib/services/vehicles';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Vehicle, VehicleCatalogEntry } from '@/types';

export default function VehiclesScreen() {
  const router = useRouter();
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
      });
      setBrand('');
      setModel('');
      setNickname('');
      setSelectedCatalogId('custom');
      await load();
      Alert.alert('Saved', 'Vehicle added to your profile.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to save vehicle');
    } finally {
      setSaving(false);
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
    <ScrollView style={styles.flex} contentContainerStyle={styles.padding}>
      <Text style={styles.heading}>My Vehicles</Text>

      <Text style={styles.sectionTitle}>Add vehicle</Text>
      <ChipSelect
        label="From catalog"
        options={catalogOptions}
        value={selectedCatalogId}
        onChange={setSelectedCatalogId}
      />
      <ChipSelect
        label="Fuel type"
        options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
        value={fuelType}
        onChange={setFuelType}
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
        label="Nickname (optional)"
        value={nickname}
        onChangeText={setNickname}
      />
      <PrimaryButton
        label={saving ? 'Saving…' : 'Add vehicle'}
        onPress={handleAdd}
        disabled={saving}
      />

      <Text style={styles.sectionTitle}>Saved vehicles</Text>
      {vehicles.length === 0 ? (
        <Card>
          <Text>No vehicles yet. Add one above or pick from the catalog.</Text>
        </Card>
      ) : (
        vehicles.map((v) => (
          <Card key={v.id}>
            <Text style={styles.vehicleTitle}>
              {v.nickname ?? `${v.brand} ${v.model}`}
            </Text>
            <Text>
              {v.brand} {v.model} · {v.year}
            </Text>
            <Text>{v.fuel_efficiency_km_per_liter} km/L</Text>
            <PrimaryButton
              label="Delete"
              variant="danger"
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
  padding: { padding: 16, paddingBottom: 32 },
  heading: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginVertical: 12 },
  vehicleTitle: { fontSize: 17, fontWeight: '700', marginBottom: 4 },
  deleteBtn: { marginTop: 12 },
});
