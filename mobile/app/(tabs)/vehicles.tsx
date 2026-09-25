import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import VehicleSharePanel from '@/components/VehicleSharePanel';
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
import { palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { useTabBarScrollHandler } from '@/context/TabBarVisibility';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  createVehicle,
  deleteVehicle,
  fetchFuelTypeIdByCode,
  fetchSharedVehicles,
  fetchVehicleCatalog,
  fetchVehicles,
  updateVehicle,
  updateVehicleLastRefill,
} from '@/lib/services/vehicles';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { SharedVehicle, Vehicle, VehicleCatalogEntry } from '@/types';

export default function VehiclesScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sharedVehicles, setSharedVehicles] = useState<SharedVehicle[]>([]);
  const [catalog, setCatalog] = useState<VehicleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<VehicleCatalogEntry | null>(null);
  const [vehicleName, setVehicleName] = useState('');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [year, setYear] = useState('');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [efficiency, setEfficiency] = useState('');
  const [lastRefillPrice, setLastRefillPrice] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);

  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [editLastRefillPrice, setEditLastRefillPrice] = useState('');
  const [updatingRefill, setUpdatingRefill] = useState(false);

  const searchResults = useMemo(() => {
    if (!catalogSearchQuery.trim() || selectedCatalogEntry) {
      return [];
    }

    const query = catalogSearchQuery.toLowerCase();
    return catalog.filter((c) =>
      c.brand.toLowerCase().includes(query) ||
      c.model.toLowerCase().includes(query)
    );
  }, [catalog, catalogSearchQuery, selectedCatalogEntry]);

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

      try {
        setSharedVehicles(await fetchSharedVehicles(user.id));
      } catch {
        setSharedVehicles([]);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSelectCatalogEntry = (entry: VehicleCatalogEntry) => {
    setSelectedCatalogEntry(entry);
    setBrand(entry.brand);
    setModel(entry.model);
    setYear(String(entry.year));
    setEfficiency(String(entry.fuel_efficiency_km_per_liter));
    if (entry.fuel_type?.code) {
      setFuelType(entry.fuel_type.code as DoeFuelTypeCode);
    }
    setCatalogSearchQuery('');
  };

  const handleClearSelection = () => {
    setSelectedCatalogEntry(null);
    setBrand('');
    setModel('');
    setYear('');
    setEfficiency('');
    setFuelType('RON_91');
    setVehicleName('');
    setFieldErrors({});
  };

  const clearFieldError = (fieldName: string) => {
    setFieldErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
  };

  const handleEditVehicle = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setVehicleName(vehicle.nickname || '');
    setBrand(vehicle.brand);
    setModel(vehicle.model);
    setYear(String(vehicle.year));
    setEfficiency(String(vehicle.fuel_efficiency_km_per_liter));
    setLastRefillPrice(vehicle.last_refill_price ? String(vehicle.last_refill_price) : '');
    setFieldErrors({});
  };

  const handleCancelEdit = () => {
    setEditingVehicle(null);
    setVehicleName('');
    setBrand('');
    setModel('');
    setYear('');
    setEfficiency('');
    setLastRefillPrice('');
    setCatalogSearchQuery('');
    setSelectedCatalogEntry(null);
    setFieldErrors({});
  };

  const handleAdd = async () => {
    if (!user) return;

    const errors: Record<string, string> = {};
    if (!vehicleName.trim()) errors.vehicleName = 'This field is required';
    if (!brand.trim()) errors.brand = 'This field is required';
    if (!model.trim()) errors.model = 'This field is required';
    if (!year.trim()) errors.year = 'This field is required';
    if (!efficiency.trim()) errors.efficiency = 'This field is required';
    if (!lastRefillPrice.trim()) errors.lastRefillPrice = 'This field is required';
    if (!fuelType) errors.fuelType = 'This field is required';

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const yearNum = parseInt(year, 10);
    const eff = parseFloat(efficiency);
    const refill = parseFloat(lastRefillPrice);

    setSaving(true);
    try {
      const fuelTypeId = await fetchFuelTypeIdByCode(fuelType);
      if (!fuelTypeId) throw new Error('Unknown fuel type');

      if (editingVehicle) {
        await updateVehicle({
          vehicleId: editingVehicle.id,
          brand,
          model,
          year: yearNum,
          fuelTypeId,
          fuelEfficiencyKmPerLiter: eff,
          nickname: vehicleName,
          lastRefillPrice: Number.isFinite(refill) && refill > 0 ? refill : undefined,
        });
      } else {
        await createVehicle({
          userId: user.id,
          catalogId: null,
          brand,
          model,
          year: yearNum,
          fuelTypeId,
          fuelEfficiencyKmPerLiter: eff,
          nickname: vehicleName,
          lastRefillPrice: Number.isFinite(refill) && refill > 0 ? refill : undefined,
        });
      }
      setBrand('');
      setModel('');
      setVehicleName('');
      setLastRefillPrice('');
      setCatalogSearchQuery('');
      setSelectedCatalogEntry(null);
      setFieldErrors({});
      setEditingVehicle(null);
      await load();
      Alert.alert('Saved', editingVehicle ? 'Vehicle updated successfully.' : 'Vehicle added to your profile.');
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

  return (
    <ScrollView
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <PageHero
        module="vehicles"
        title="My Vehicles"
        subtitle={`${vehicles.length} Vehicle${vehicles.length !== 1 ? 's' : ''} Saved`}
      />

      <FormSection title={editingVehicle ? "Edit vehicle" : "Add vehicle"} subtitle={editingVehicle ? "Update vehicle details" : "Search catalog or enter manually"} module="vehicles">
        <LabeledInput
          label="Search catalog"
          value={catalogSearchQuery}
          onChangeText={setCatalogSearchQuery}
          placeholder="Type brand or model to search..."
          editable={!selectedCatalogEntry}
        />
        {selectedCatalogEntry && (
          <View style={[styles.selectedVehicleChip, { backgroundColor: palette.primary }]}>
            <Text style={styles.selectedVehicleText}>
              {selectedCatalogEntry.brand} {selectedCatalogEntry.model} ({selectedCatalogEntry.year})
            </Text>
            <TouchableOpacity onPress={handleClearSelection} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {searchResults.length > 0 && (
          <View style={styles.searchResults}>
            {searchResults.map((entry) => (
              <TouchableOpacity
                key={entry.id}
                style={[styles.searchResultItem, { backgroundColor: theme.overlay }]}
                onPress={() => handleSelectCatalogEntry(entry)}
              >
                <Text style={[styles.searchResultText, { color: theme.text }]}>
                  {entry.brand} {entry.model} ({entry.year})
                </Text>
                <Text style={[styles.searchResultSubtext, { color: theme.textSecondary }]}>
                  {entry.fuel_efficiency_km_per_liter} km/L
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <ChipSelect
          label="Fuel type"
          options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
          value={fuelType}
          onChange={(value) => {
            setFuelType(value);
            clearFieldError('fuelType');
          }}
          module="vehicles"
        />
        {fieldErrors.fuelType && <Text style={styles.errorText}>{fieldErrors.fuelType}</Text>}
        <LabeledInput
          label="Brand"
          value={brand}
          onChangeText={(text) => {
            setBrand(text);
            clearFieldError('brand');
          }}
          placeholder="e.g. Toyota"
          style={fieldErrors.brand ? { borderColor: palette.danger } : undefined}
        />
        {fieldErrors.brand && <Text style={styles.errorText}>{fieldErrors.brand}</Text>}

        <LabeledInput
          label="Model"
          value={model}
          onChangeText={(text) => {
            setModel(text);
            clearFieldError('model');
          }}
          placeholder="e.g. Vios"
          style={fieldErrors.model ? { borderColor: palette.danger } : undefined}
        />
        {fieldErrors.model && <Text style={styles.errorText}>{fieldErrors.model}</Text>}

        <LabeledInput
          label="Year"
          value={year}
          onChangeText={(text) => {
            setYear(text);
            clearFieldError('year');
          }}
          keyboardType="number-pad"
          placeholder="e.g. 2022"
          style={fieldErrors.year ? { borderColor: palette.danger } : undefined}
        />
        {fieldErrors.year && <Text style={styles.errorText}>{fieldErrors.year}</Text>}

        <LabeledInput
          label="Fuel efficiency (km/L)"
          value={efficiency}
          onChangeText={(text) => {
            setEfficiency(text);
            clearFieldError('efficiency');
          }}
          keyboardType="decimal-pad"
          placeholder="e.g. 14"
          style={fieldErrors.efficiency ? { borderColor: palette.danger } : undefined}
        />
        {fieldErrors.efficiency && <Text style={styles.errorText}>{fieldErrors.efficiency}</Text>}

        <LabeledInput
          label="Last refill price (₱/L)"
          value={lastRefillPrice}
          onChangeText={(text) => {
            setLastRefillPrice(text);
            clearFieldError('lastRefillPrice');
          }}
          keyboardType="decimal-pad"
          placeholder="e.g. 65.50"
          style={fieldErrors.lastRefillPrice ? { borderColor: palette.danger } : undefined}
        />
        {fieldErrors.lastRefillPrice && <Text style={styles.errorText}>{fieldErrors.lastRefillPrice}</Text>}

        <LabeledInput
          label="Vehicle name"
          value={vehicleName}
          onChangeText={(text) => {
            setVehicleName(text);
            clearFieldError('vehicleName');
          }}
          placeholder="e.g. My Car"
          style={fieldErrors.vehicleName ? { borderColor: palette.danger } : undefined}
        />
        {fieldErrors.vehicleName && <Text style={styles.errorText}>{fieldErrors.vehicleName}</Text>}
        <PrimaryButton label={saving ? 'Saving…' : (editingVehicle ? 'Update vehicle' : 'Add vehicle')} onPress={handleAdd} disabled={saving} />
        {editingVehicle && (
          <PrimaryButton
            label="Cancel"
            variant="secondary"
            onPress={handleCancelEdit}
            style={styles.cancelEditBtn}
          />
        )}
      </FormSection>

      {!editingVehicle && (
        <>
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

                <VehicleSharePanel vehicleId={v.id} ownerId={user.id} />

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
                ) : editingVehicle === null ? (
                  <>
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
                    <PrimaryButton
                      label="Edit"
                      variant="secondary"
                      size="sm"
                      onPress={() => handleEditVehicle(v)}
                      style={styles.actionBtn}
                    />
                  </>
                ) : null}

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
        </>
      )}

      <SectionHeader
        title="Shared with me"
        subtitle={`${sharedVehicles.length} shared vehicle${sharedVehicles.length !== 1 ? 's' : ''}`}
        module="vehicles"
      />
      {sharedVehicles.length === 0 ? (
        <EmptyState
          title="No shared vehicles"
          message="Vehicles shared with you will appear here."
        />
      ) : (
        sharedVehicles.map((sharedVehicle) => (
          <TouchableOpacity
            key={sharedVehicle.vehicleId}
            onPress={() =>
              router.push({
                pathname: '/shared-vehicle-history',
                params: {
                  vehicleId: sharedVehicle.vehicleId,
                  vehicleLabel: `${sharedVehicle.brand} ${sharedVehicle.model}`,
                },
              })
            }
            style={styles.sharedVehicleButton}>
            <Card elevated compact>
              <View style={styles.sharedVehicleRow}>
                <View style={styles.sharedVehicleInfo}>
                  <Text style={[styles.sharedVehicleTitle, { color: theme.text }]}>
                    {sharedVehicle.brand} {sharedVehicle.model}
                  </Text>
                  <Text style={[styles.sharedVehicleRole, { color: theme.textSecondary }]}>
                    {sharedVehicle.role}
                  </Text>
                </View>
                <Text style={[styles.sharedVehicleChevron, { color: theme.textSecondary }]}>›</Text>
              </View>
            </Card>
          </TouchableOpacity>
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
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  refillLabel: { fontSize: 12, fontWeight: '600' },
  refillValue: { fontSize: 14, fontWeight: '700' },
  missingRefill: { color: palette.warning, fontWeight: '600', marginBottom: spacing.sm },
  actionBtn: { marginTop: spacing.sm },
  deleteBtn: { marginTop: spacing.sm },
  cancelEditBtn: { marginTop: spacing.sm },
  selectedVehicleChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  selectedVehicleText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F8F0E5',
  },
  clearButton: {
    padding: spacing.sm,
  },
  clearButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#F8F0E5',
  },
  searchResults: {
    marginBottom: spacing.md,
  },
  searchResultItem: {
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
  searchResultText: {
    fontSize: 16,
    fontWeight: '600',
  },
  searchResultSubtext: {
    fontSize: 14,
    marginTop: 2,
  },
  sharedVehicleButton: {
    width: '100%',
  },
  sharedVehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sharedVehicleInfo: {
    flex: 1,
  },
  sharedVehicleTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  sharedVehicleRole: {
    fontSize: 13,
    marginTop: 3,
  },
  sharedVehicleChevron: {
    fontSize: 28,
    fontWeight: '300',
    marginLeft: spacing.sm,
  },
  errorText: {
    color: palette.danger,
    fontSize: 12,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
});