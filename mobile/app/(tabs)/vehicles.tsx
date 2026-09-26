import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import VehicleSharePanel from '@/components/VehicleSharePanel';
import ChipSelect from '@/components/ui/ChipSelect';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { HomeColors } from '@/constants/home';
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
import type { SharedVehicle, Vehicle, VehicleCatalogEntry } from '@/types';

export default function VehiclesScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const scrollRef = useRef<ScrollView>(null);
  // The add/edit form is collapsed by default so saved vehicles lead the page.
  const [formOpen, setFormOpen] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [sharedVehicles, setSharedVehicles] = useState<SharedVehicle[]>([]);
  const [catalog, setCatalog] = useState<VehicleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<VehicleCatalogEntry | null>(
    null,
  );
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
    return catalog.filter(
      (c) => c.brand.toLowerCase().includes(query) || c.model.toLowerCase().includes(query),
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
    setFieldErrors((prev) => {
      const newErrors = { ...prev };
      delete newErrors[fieldName];
      return newErrors;
    });
  };

  /** Scrolls the form into view so Edit never leaves the user mid-page. */
  const revealForm = useCallback(() => {
    setFormOpen(true);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  const handleOpenAdd = useCallback(() => {
    setEditingVehicle(null);
    revealForm();
  }, [revealForm]);

  const handleEditVehicle = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setVehicleName(vehicle.nickname || '');
    setBrand(vehicle.brand);
    setModel(vehicle.model);
    setYear(String(vehicle.year));
    setEfficiency(String(vehicle.fuel_efficiency_km_per_liter));
    setLastRefillPrice(vehicle.last_refill_price ? String(vehicle.last_refill_price) : '');
    setFieldErrors({});
    revealForm();
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
    setFormOpen(false);
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
      setFormOpen(false);
      await load();
      Alert.alert(
        'Saved',
        editingVehicle ? 'Vehicle updated successfully.' : 'Vehicle added to your profile.',
      );
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
      ref={scrollRef}
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={[styles.flex, { backgroundColor: HomeColors.background }]}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Vehicles</Text>
        <Text style={styles.headerSubtitle}>Manage your vehicles and fuel details.</Text>
      </View>

      {formOpen ? (
        <View style={styles.formCard}>
          <View style={styles.formCardHead}>
            <Text style={styles.formCardTitle}>
              {editingVehicle ? 'Edit vehicle' : 'Add vehicle'}
            </Text>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={10}
              onPress={handleCancelEdit}
              style={styles.formClose}>
              <Ionicons name="close" size={18} color={HomeColors.muted} />
            </Pressable>
          </View>

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
          {fieldErrors.vehicleName && (
            <Text style={styles.errorText}>{fieldErrors.vehicleName}</Text>
          )}

          <LabeledInput
            label="Search vehicle catalog"
            value={catalogSearchQuery}
            onChangeText={setCatalogSearchQuery}
            placeholder="Type brand or model to search..."
            editable={!selectedCatalogEntry}
          />
          {selectedCatalogEntry && (
            <View style={[styles.selectedVehicleChip, { backgroundColor: HomeColors.primary }]}>
              <Text style={styles.selectedVehicleText}>
                {selectedCatalogEntry.brand} {selectedCatalogEntry.model} (
                {selectedCatalogEntry.year})
              </Text>
              <Pressable onPress={handleClearSelection} style={styles.clearButton}>
                <Ionicons name="close" size={16} color={HomeColors.onPrimary} />
              </Pressable>
            </View>
          )}
          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((entry) => (
                <Pressable
                  key={entry.id}
                  style={[styles.searchResultItem, { backgroundColor: HomeColors.navySoft }]}
                  onPress={() => handleSelectCatalogEntry(entry)}>
                  <Text style={styles.searchResultText}>
                    {entry.brand} {entry.model} ({entry.year})
                  </Text>
                  <Text style={styles.searchResultSubtext}>
                    {entry.fuel_efficiency_km_per_liter} km/L
                  </Text>
                </Pressable>
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
          {fieldErrors.lastRefillPrice && (
            <Text style={styles.errorText}>{fieldErrors.lastRefillPrice}</Text>
          )}

          <PrimaryButton
            label={saving ? 'Saving…' : editingVehicle ? 'Update vehicle' : 'Add vehicle'}
            onPress={handleAdd}
            disabled={saving}
          />
          {editingVehicle ? (
            <PrimaryButton
              label="Cancel"
              variant="secondary"
              onPress={handleCancelEdit}
              style={styles.cancelEditBtn}
            />
          ) : null}
        </View>
      ) : (
        <Pressable
          accessibilityLabel="Add vehicle"
          accessibilityRole="button"
          onPress={handleOpenAdd}
          style={({ pressed }) => [styles.addAction, pressed && styles.addActionPressed]}>
          <View style={styles.addActionIcon}>
            <Ionicons name="add" size={20} color={HomeColors.primary} />
          </View>
          <Text style={styles.addActionLabel}>Add vehicle</Text>
          <Ionicons name="chevron-forward" size={16} color={HomeColors.primary} />
        </Pressable>
      )}

      {vehicles.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Ionicons name="car-outline" size={22} color={HomeColors.muted} />
          <Text style={styles.emptyTitle}>No vehicles yet</Text>
          <Text style={styles.emptyMessage}>
            Add your first vehicle to use it in the Trip Optimizer.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.sectionLabel}>Saved vehicles</Text>
          {vehicles.map((v) => {
            const hasRefill = v.last_refill_price != null;
            const showRefillForm = editingVehicleId === v.id;
            const isEditingThis = editingVehicle?.id === v.id;

            return (
              <View key={v.id} style={styles.vehicleCard}>
                <View style={styles.vehicleCardHead}>
                  <View style={styles.vehicleIcon}>
                    <Ionicons name="car-outline" size={18} color={HomeColors.primary} />
                  </View>
                  <View style={styles.vehicleCardTitles}>
                    <Text numberOfLines={1} style={styles.vehicleName}>
                      {v.nickname ?? `${v.brand} ${v.model}`}
                    </Text>
                    <Text numberOfLines={1} style={styles.vehicleMeta}>
                      {v.brand} {v.model} · {v.year} · {v.fuel_efficiency_km_per_liter} km/L
                    </Text>
                  </View>
                </View>

                <View style={styles.cardDivider} />

                {hasRefill ? (
                  <View style={styles.refillRow}>
                    <Text style={styles.refillLabel}>Last refill</Text>
                    <Text numberOfLines={1} style={styles.refillValue}>
                      {formatCurrency(v.last_refill_price as number)}/L
                      {v.last_refill_at ? ` · ${formatDate(v.last_refill_at)}` : ''}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.refillRow}>
                    <Text style={styles.refillLabel}>Last refill</Text>
                    <Text numberOfLines={1} style={styles.missingRefill}>
                      No refill price yet
                    </Text>
                  </View>
                )}

                {showRefillForm ? (
                  <View style={styles.inlineForm}>
                    <LabeledInput
                      label="Last refill price (₱/L)"
                      value={editLastRefillPrice}
                      onChangeText={setEditLastRefillPrice}
                      keyboardType="decimal-pad"
                    />
                    <View style={styles.inlineFormActions}>
                      <PrimaryButton
                        label={updatingRefill ? 'Saving…' : 'Save'}
                        onPress={() => handleUpdateLastRefill(v.id)}
                        disabled={updatingRefill}
                        style={styles.inlineFormAction}
                      />
                      <PrimaryButton
                        label="Cancel"
                        variant="secondary"
                        onPress={() => {
                          setEditingVehicleId(null);
                          setEditLastRefillPrice('');
                        }}
                        style={styles.inlineFormAction}
                      />
                    </View>
                  </View>
                ) : null}

                <VehicleSharePanel vehicleId={v.id} ownerId={user.id} />

                {isEditingThis ? (
                  <View style={styles.editingNote}>
                    <Ionicons name="pencil" size={13} color={HomeColors.primary} />
                    <Text style={styles.editingNoteText}>
                      Editing above — tap Cancel to discard.
                    </Text>
                  </View>
                ) : null}

                {showRefillForm || isEditingThis ? null : (
                  <View style={styles.cardActions}>
                    <Pressable
                      accessibilityLabel="Update last refill"
                      accessibilityRole="button"
                      onPress={() => {
                        setEditingVehicleId(v.id);
                        setEditLastRefillPrice(hasRefill ? String(v.last_refill_price) : '');
                      }}
                      style={({ pressed }) => [
                        styles.cardAction,
                        pressed && styles.cardActionPressed,
                      ]}>
                      <Ionicons name="cash-outline" size={14} color={HomeColors.primary} />
                      <Text style={styles.cardActionLabel}>
                        {hasRefill ? 'Update refill' : 'Set refill'}
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Edit vehicle"
                      accessibilityRole="button"
                      onPress={() => handleEditVehicle(v)}
                      style={({ pressed }) => [
                        styles.cardAction,
                        pressed && styles.cardActionPressed,
                      ]}>
                      <Ionicons name="create-outline" size={14} color={HomeColors.muted} />
                      <Text style={styles.cardActionLabelMuted}>Edit</Text>
                    </Pressable>
                    <Pressable
                      accessibilityLabel="Delete vehicle"
                      accessibilityRole="button"
                      onPress={() => handleDelete(v.id)}
                      style={({ pressed }) => [
                        styles.cardAction,
                        pressed && styles.cardActionPressed,
                      ]}>
                      <Ionicons name="trash-outline" size={14} color={palette.danger} />
                      <Text style={styles.cardActionLabelDanger}>Delete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}

      <Text style={styles.sectionLabel}>Shared with me</Text>
      {sharedVehicles.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyMessage}>Vehicles shared with you will appear here.</Text>
        </View>
      ) : (
        sharedVehicles.map((sharedVehicle) => (
          <Pressable
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
            style={({ pressed }) => [styles.sharedRow, pressed && styles.cardActionPressed]}>
            <View style={styles.vehicleCardTitles}>
              <Text numberOfLines={1} style={styles.vehicleName}>
                {sharedVehicle.brand} {sharedVehicle.model}
              </Text>
              <Text numberOfLines={1} style={styles.vehicleMeta}>
                {sharedVehicle.role}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={HomeColors.muted} />
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

/** Layout rhythm. Matches the Home screen so both tabs read as one app. */
const SECTION_GAP = 28;
const SURFACE_PAD = 18;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  header: {
    marginTop: spacing.xl,
    marginBottom: SECTION_GAP,
  },
  headerTitle: {
    color: HomeColors.navy,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  headerSubtitle: {
    color: HomeColors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  sectionLabel: {
    color: HomeColors.navy,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
    marginTop: SECTION_GAP,
    marginBottom: spacing.sm,
  },

  // Single primary action, replacing the always-visible form.
  addAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: SURFACE_PAD,
    borderRadius: radii.md,
    backgroundColor: HomeColors.primary,
  },
  addActionPressed: {
    opacity: 0.85,
  },
  addActionIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HomeColors.onPrimary,
  },
  addActionLabel: {
    flex: 1,
    color: HomeColors.onPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },

  // Collapsible add/edit form. Flat surface — no blur, no gradient.
  formCard: {
    padding: SURFACE_PAD,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: HomeColors.onPrimary,
  },
  formCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  formCardTitle: {
    color: HomeColors.navy,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  formClose: {
    padding: 2,
  },
  cancelEditBtn: {
    marginTop: spacing.sm,
  },
  errorText: {
    color: palette.danger,
    fontSize: 12,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },

  selectedVehicleChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  selectedVehicleText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: HomeColors.onPrimary,
  },
  clearButton: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  searchResults: {
    marginBottom: spacing.md,
  },
  searchResultItem: {
    padding: spacing.md,
    borderRadius: radii.sm,
    marginBottom: spacing.xs,
  },
  searchResultText: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  searchResultSubtext: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  // Compact vehicle card — flat surface, hairline border, no shadow.
  vehicleCard: {
    padding: SURFACE_PAD,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: HomeColors.onPrimary,
    marginBottom: spacing.md,
  },
  vehicleCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  vehicleIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HomeColors.primarySoft,
  },
  vehicleCardTitles: {
    flex: 1,
    minWidth: 0,
  },
  vehicleName: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  vehicleMeta: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HomeColors.border,
    marginVertical: spacing.md,
  },
  refillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  refillLabel: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  refillValue: {
    flexShrink: 1,
    color: HomeColors.navy,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  missingRefill: {
    flexShrink: 1,
    color: palette.warning,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700',
  },
  inlineForm: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HomeColors.border,
  },
  inlineFormActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inlineFormAction: {
    flex: 1,
  },
  editingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: HomeColors.primarySoft,
  },
  editingNoteText: {
    flex: 1,
    color: HomeColors.navy,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  // One compact action row instead of stacked full-width buttons.
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HomeColors.border,
  },
  cardAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  cardActionPressed: {
    backgroundColor: HomeColors.navySoft,
  },
  cardActionLabel: {
    color: HomeColors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  cardActionLabelMuted: {
    color: HomeColors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  cardActionLabelDanger: {
    color: palette.danger,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  emptyBlock: {
    alignItems: 'center',
    paddingHorizontal: SURFACE_PAD,
    paddingVertical: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: HomeColors.navySoft,
    marginTop: SECTION_GAP,
  },
  emptyTitle: {
    color: HomeColors.navy,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  emptyMessage: {
    color: HomeColors.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 2,
  },
  sharedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: SURFACE_PAD,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HomeColors.border,
    backgroundColor: HomeColors.onPrimary,
    marginBottom: spacing.sm,
  },
});
