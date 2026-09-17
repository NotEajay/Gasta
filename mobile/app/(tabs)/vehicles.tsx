import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

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
import { moduleColors } from '@/constants/moduleColors';
import { palette, radii, spacing, typography } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency, formatDate } from '@/lib/format';
import {
  createVehicle,
  deleteVehicle,
  fetchFuelTypeIdByCode,
  fetchVehicleCatalog,
  fetchVehicles,
  updateVehicle,
  updateVehicleLastRefill,
} from '@/lib/services/vehicles';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import type { Vehicle, VehicleCatalogEntry } from '@/types';

interface CatalogPickerProps {
  catalog: VehicleCatalogEntry[];
  selectedId: string;
  onSelect: (entry: VehicleCatalogEntry) => void;
  onCustom: () => void;
}

function CatalogPicker({ catalog, selectedId, onSelect, onCustom }: CatalogPickerProps) {
  const theme = useTheme();
  const accent = moduleColors.vehicles.main;
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const matches = catalog
    .filter((entry) =>
      `${entry.brand} ${entry.model} ${entry.year}`.toLowerCase().includes(normalizedQuery)
    )
    .slice(0, 8);
  const selected = catalog.find((entry) => entry.id === selectedId);

  return (
    <View style={styles.catalogPicker}>
      <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>Vehicle catalog</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search brand, model, or year"
        placeholderTextColor={theme.textMuted}
        style={[
          styles.catalogSearch,
          { color: theme.text, borderColor: theme.border, backgroundColor: '#FFFFFF' },
        ]}
      />
      {selected ? (
        <View style={[styles.selectedCatalog, { backgroundColor: accent }]}>
          <View style={styles.selectedCatalogText}>
            <Text style={styles.selectedCatalogLabel}>Selected vehicle</Text>
            <Text style={styles.selectedCatalogValue}>
              {selected.brand} {selected.model} · {selected.year}
            </Text>
          </View>
          <Pressable onPress={onCustom} hitSlop={8}>
            <Text style={styles.changeCatalog}>Change</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          onPress={onCustom}
          style={[styles.customCatalog, { borderColor: theme.border }]}>
          <Text style={[styles.customCatalogTitle, { color: theme.text }]}>Custom entry</Text>
          <Text style={[styles.customCatalogHint, { color: theme.textSecondary }]}>
            Enter your vehicle details manually
          </Text>
        </Pressable>
      )}
      {query.length > 0 && !selected ? (
        <View style={[styles.catalogResults, { borderColor: theme.border }]}>
          {matches.length > 0 ? (
            matches.map((entry) => (
              <Pressable
                key={entry.id}
                onPress={() => {
                  onSelect(entry);
                  setQuery('');
                }}
                style={({ pressed }) => [
                  styles.catalogResult,
                  { backgroundColor: pressed ? theme.overlay : theme.surface },
                ]}>
                <Text style={[styles.catalogResultTitle, { color: theme.text }]}>
                  {entry.brand} {entry.model}
                </Text>
                <Text style={[styles.catalogResultMeta, { color: theme.textSecondary }]}>
                  {entry.year} · {entry.fuel_type?.name ?? 'Fuel type available'}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={[styles.noCatalogResults, { color: theme.textSecondary }]}>
              No catalog vehicles found. Try a different search or use custom entry.
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

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
  const [editBrand, setEditBrand] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editYear, setEditYear] = useState('');
  const [editFuelType, setEditFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [editEfficiency, setEditEfficiency] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editLastRefillPrice, setEditLastRefillPrice] = useState('');
  const [updatingVehicle, setUpdatingVehicle] = useState(false);
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
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to load vehicles');
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
    if (!brand.trim() || !model.trim() || !Number.isInteger(yearNum) || yearNum < 1980 || yearNum > 2100 || !Number.isFinite(eff) || eff <= 0) {
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

  const handleCatalogSelect = (entry: VehicleCatalogEntry) => {
    setSelectedCatalogId(entry.id);
    setBrand(entry.brand);
    setModel(entry.model);
    setYear(String(entry.year));
    setEfficiency(String(entry.fuel_efficiency_km_per_liter));
    if (entry.fuel_type?.code) setFuelType(entry.fuel_type.code as DoeFuelTypeCode);
  };

  const startEditing = (vehicle: Vehicle) => {
    setEditingVehicleId(vehicle.id);
    setEditBrand(vehicle.brand);
    setEditModel(vehicle.model);
    setEditYear(String(vehicle.year));
    setEditEfficiency(String(vehicle.fuel_efficiency_km_per_liter));
    setEditNickname(vehicle.nickname ?? '');
    setEditFuelType(vehicle.fuel_type?.code ?? 'RON_91');
    setEditLastRefillPrice(
      vehicle.last_refill_price != null ? String(vehicle.last_refill_price) : ''
    );
  };

  const cancelEditing = () => {
    setEditingVehicleId(null);
    setEditBrand('');
    setEditModel('');
    setEditYear('');
    setEditEfficiency('');
    setEditNickname('');
    setEditLastRefillPrice('');
  };

  const handleUpdate = async (vehicleId: string) => {
    if (!user) return;
    const yearNum = parseInt(editYear, 10);
    const eff = parseFloat(editEfficiency);
    if (
      !editBrand.trim() ||
      !editModel.trim() ||
      !Number.isInteger(yearNum) ||
      yearNum < 1980 ||
      yearNum > 2100 ||
      !Number.isFinite(eff) ||
      eff <= 0
    ) {
      Alert.alert('Invalid fields', 'Enter a valid brand, model, year, and efficiency.');
      return;
    }

    setUpdatingVehicle(true);
    try {
      const fuelTypeId = await fetchFuelTypeIdByCode(editFuelType);
      if (!fuelTypeId) throw new Error('Unknown fuel type');
      await updateVehicle(vehicleId, {
        userId: user.id,
        brand: editBrand.trim(),
        model: editModel.trim(),
        year: yearNum,
        fuelTypeId,
        fuelEfficiencyKmPerLiter: eff,
        nickname: editNickname,
      });
      cancelEditing();
      await load();
      Alert.alert('Updated', 'Vehicle details saved.');
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to update vehicle');
    } finally {
      setUpdatingVehicle(false);
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
      if (!user) return;
      await updateVehicleLastRefill(vehicleId, user.id, price);
      cancelEditing();
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
            if (!user) return;
            await deleteVehicle(vehicleId, user.id);
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
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <PageHero
        module="vehicles"
        title="My Vehicles"
        subtitle="Keep your vehicle details ready for smarter trip decisions."
      >
        <View style={[styles.heroPanel, { backgroundColor: moduleColors.vehicles.main }]}>
          <View style={styles.heroPanelCopy}>
            <Text style={styles.heroEyebrow}>YOUR GARAGE</Text>
            <Text style={styles.heroHeadline}>
              {vehicles.length === 0
                ? 'Add your first vehicle'
                : `${vehicles.length} ${vehicles.length === 1 ? 'vehicle' : 'vehicles'} ready`}
            </Text>
            <Text style={styles.heroDescription}>
              {vehicles.length === 0
                ? 'Save a profile to personalize fuel-cost estimates.'
                : 'Profiles are used in the Trip Cost Optimizer.'}
            </Text>
          </View>
          <View style={styles.heroCount}>
            <Text style={styles.heroCountValue}>{vehicles.length}</Text>
            <Text style={styles.heroCountLabel}>SAVED</Text>
          </View>
        </View>
      </PageHero>

      <FormSection
        title="Add vehicle"
        subtitle="Start with a catalog match or enter your details manually"
        module="vehicles">
        <CatalogPicker
          catalog={catalog}
          selectedId={selectedCatalogId === 'custom' ? '' : selectedCatalogId}
          onSelect={handleCatalogSelect}
          onCustom={() => setSelectedCatalogId('custom')}
        />
        <Text style={[styles.formGroupLabel, { color: theme.textSecondary }]}>
          Vehicle details
        </Text>
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
          label="Last refill price (₱/L)"
          value={lastRefillPrice}
          onChangeText={setLastRefillPrice}
          keyboardType="decimal-pad"
        />
        <LabeledInput label="Nickname (optional)" value={nickname} onChangeText={setNickname} />
        <Text style={[styles.formHint, { color: theme.textSecondary }]}>
          Add a refill price to unlock more accurate trip-cost estimates.
        </Text>
        <PrimaryButton
          label={saving ? 'Saving…' : 'Add vehicle'}
          onPress={handleAdd}
          disabled={saving}
        />
      </FormSection>

      <SectionHeader title="Saved vehicles" subtitle={`${vehicles.length} registered`} module="vehicles" />
      {vehicles.length === 0 ? (
        <EmptyState
          title="No vehicles yet"
          message="Add your car above to use it in the Trip Optimizer."
        />
      ) : (
        vehicles.map((v) => (
          <Card key={v.id} elevated style={styles.vehicleCard}>
            <View style={styles.vehicleHeader}>
              <View style={[styles.vehicleBadge, { backgroundColor: moduleColors.vehicles.main }]}>
                <Text style={styles.vehicleBadgeText}>
                  {(v.nickname ?? v.brand).slice(0, 1).toUpperCase()}
                </Text>
              </View>
              <View style={styles.vehicleHeading}>
                <Text style={[styles.vehicleTitle, { color: theme.text }]}>
                  {v.nickname ?? `${v.brand} ${v.model}`}
                </Text>
                <Text style={[styles.vehicleMeta, { color: theme.textSecondary }]}>
                  {v.brand} {v.model} · {v.year}
                </Text>
              </View>
            </View>
            <View style={styles.vehicleStats}>
              <View style={[styles.statPill, { backgroundColor: theme.overlay }]}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Efficiency</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>
                  {v.fuel_efficiency_km_per_liter} km/L
                </Text>
              </View>
              <View style={[styles.statPill, { backgroundColor: theme.overlay }]}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Fuel</Text>
                <Text style={[styles.statValue, { color: theme.text }]}>
                  {v.fuel_type?.name ?? 'Not set'}
                </Text>
              </View>
            </View>
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
                <View style={[styles.editingNotice, { backgroundColor: theme.overlay }]}>
                  <Text style={[styles.editingNoticeTitle, { color: theme.text }]}>
                    Editing vehicle
                  </Text>
                  <Text style={[styles.editingNoticeText, { color: theme.textSecondary }]}>
                    Update the details below, then save your changes.
                  </Text>
                </View>
                <LabeledInput label="Brand" value={editBrand} onChangeText={setEditBrand} />
                <LabeledInput label="Model" value={editModel} onChangeText={setEditModel} />
                <LabeledInput
                  label="Year"
                  value={editYear}
                  onChangeText={setEditYear}
                  keyboardType="number-pad"
                />
                <ChipSelect
                  label="Fuel type"
                  options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
                  value={editFuelType}
                  onChange={setEditFuelType}
                  module="vehicles"
                />
                <LabeledInput
                  label="Fuel efficiency (km/L)"
                  value={editEfficiency}
                  onChangeText={setEditEfficiency}
                  keyboardType="decimal-pad"
                />
                <LabeledInput
                  label="Nickname (optional)"
                  value={editNickname}
                  onChangeText={setEditNickname}
                />
                <PrimaryButton
                  label={updatingVehicle ? 'Saving…' : 'Save vehicle details'}
                  onPress={() => handleUpdate(v.id)}
                  disabled={updatingVehicle || updatingRefill}
                  style={styles.actionBtn}
                />
                <LabeledInput
                  label="Update last refill price (₱/L)"
                  value={editLastRefillPrice}
                  onChangeText={setEditLastRefillPrice}
                  keyboardType="decimal-pad"
                />
                <PrimaryButton
                  label={updatingRefill ? 'Saving…' : 'Save last refill'}
                  onPress={() => handleUpdateLastRefill(v.id)}
                  disabled={updatingRefill || updatingVehicle}
                  style={styles.actionBtn}
                />
                <PrimaryButton
                  label="Cancel"
                  variant="secondary"
                  onPress={cancelEditing}
                  style={styles.actionBtn}
                />
              </>
            ) : (
              <View style={styles.actionRow}>
                <PrimaryButton
                  label="Edit vehicle"
                  variant="secondary"
                  size="sm"
                  onPress={() => startEditing(v)}
                  style={{ ...styles.actionBtn, ...styles.actionRowBtn }}
                />
                <PrimaryButton
                  label="Delete"
                  variant="danger"
                  size="sm"
                  onPress={() => handleDelete(v.id)}
                  style={{ ...styles.actionBtn, ...styles.actionRowBtn }}
                />
              </View>
            )}

            {editingVehicleId === v.id ? (
              <PrimaryButton
                label="Delete vehicle"
                variant="danger"
                size="sm"
                onPress={() => handleDelete(v.id)}
                style={styles.deleteBtn}
              />
            ) : null}
          </Card>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  padding: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heroPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  heroPanelCopy: { flex: 1, paddingRight: spacing.md },
  heroEyebrow: {
    color: 'rgba(248, 240, 229, 0.72)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  heroHeadline: {
    color: '#F8F0E5',
    fontSize: 19,
    fontWeight: '800',
    marginTop: spacing.xs,
  },
  heroDescription: {
    color: 'rgba(248, 240, 229, 0.82)',
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  heroCount: {
    width: 68,
    height: 68,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 240, 229, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(248, 240, 229, 0.28)',
  },
  heroCountValue: { color: '#F8F0E5', fontSize: 26, fontWeight: '800' },
  heroCountLabel: {
    color: 'rgba(248, 240, 229, 0.76)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginTop: -2,
  },
  catalogPicker: { marginBottom: spacing.md },
  fieldLabel: { ...typography.label, marginBottom: spacing.sm },
  formGroupLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  formHint: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  catalogSearch: {
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  selectedCatalog: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  selectedCatalogText: { flex: 1, marginRight: spacing.sm },
  selectedCatalogLabel: {
    color: 'rgba(248, 240, 229, 0.76)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  selectedCatalogValue: {
    color: '#F8F0E5',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  changeCatalog: { color: '#F8F0E5', fontSize: 13, fontWeight: '800' },
  customCatalog: {
    borderWidth: 1.5,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  customCatalogTitle: { fontSize: 15, fontWeight: '700' },
  customCatalogHint: { fontSize: 12, marginTop: 2 },
  catalogResults: {
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    marginTop: spacing.xs,
  },
  catalogResult: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(1, 68, 33, 0.12)',
  },
  catalogResultTitle: { fontSize: 15, fontWeight: '700' },
  catalogResultMeta: { fontSize: 12, marginTop: 2 },
  noCatalogResults: { padding: spacing.md, fontSize: 13, lineHeight: 18 },
  vehicleCard: { padding: spacing.md },
  vehicleHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  vehicleBadge: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  vehicleBadgeText: { color: '#F8F0E5', fontSize: 20, fontWeight: '800' },
  vehicleHeading: { flex: 1 },
  vehicleTitle: { fontSize: 18, fontWeight: '800', marginBottom: 3 },
  vehicleMeta: { fontSize: 13 },
  vehicleStats: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  statPill: { flex: 1, borderRadius: radii.sm, padding: spacing.sm },
  statLabel: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  statValue: { fontSize: 14, fontWeight: '800' },
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
  editingNotice: { borderRadius: radii.sm, padding: spacing.sm, marginBottom: spacing.sm },
  editingNoticeTitle: { fontSize: 14, fontWeight: '800' },
  editingNoticeText: { fontSize: 12, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  actionRowBtn: { flex: 1 },
  actionBtn: { marginTop: spacing.sm },
  deleteBtn: { marginTop: spacing.sm },
});
