import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import VehicleSharePanel from '@/components/VehicleSharePanel';
import VehicleRefillPanel from '@/components/vehicle/VehicleRefillPanel';
import ChipSelect from '@/components/ui/ChipSelect';
import EmptyState from '@/components/ui/EmptyState';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
// NOTE: Vehicles now uses the GasTa cream/forest palette, matching Sign In,
// Profile and Budget. `HomeColors` is no longer imported here.
import {
  GasTaColors,
  GasTaRadius,
  GasTaSpacing,
  palette,
  typeScale,
} from '@/constants/Theme';
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

  /**
   * Card interaction state.
   *
   * `shareOpenId` is the single share panel the header button drives, so only
   * one vehicle's sharing panel is open at a time. `menuFor` is the vehicle whose
   * overflow menu is showing. `triggerNodes` keeps one measured anchor node per
   * vehicle so the menu can be positioned under the right ellipsis.
   */
  const [shareOpenId, setShareOpenId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Vehicle | null>(null);
  const [menuHasRefill, setMenuHasRefill] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; width: number } | null>(
    null,
  );
  const triggerNodes = useRef<Record<string, View | null>>({});

  const toggleShare = useCallback((vehicleId: string) => {
    setShareOpenId((current) => (current === vehicleId ? null : vehicleId));
  }, []);

  /**
   * Opens the overflow for one vehicle, anchored under its own ellipsis.
   * Measurement goes through a plain View wrapper because this project's
   * react-native type surface does not expose `measureInWindow` on Pressable —
   * the same constraint RefillSplitSheet already works around.
   */
  const openMenu = useCallback((vehicle: Vehicle, hasRefill: boolean) => {
    setMenuFor(vehicle);
    setMenuHasRefill(hasRefill);
    const node = triggerNodes.current[vehicle.id];
    if (node) {
      node.measureInWindow((x, y, width) => {
        setMenuAnchor({ x, y, width });
      });
    }
  }, []);

  const closeMenu = useCallback(() => {
    setMenuFor(null);
    setMenuAnchor(null);
  }, []);

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
    // Dismissing the menu first, so the form it opens is never behind it.
    closeMenu();
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
    closeMenu();
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
            // vehicle_refills.vehicle_id is ON DELETE RESTRICT, so a vehicle with
            // refill history cannot be removed. Voiding does NOT help: a voided
            // row still exists and still references the vehicle, so there is no
            // in-app way to unblock this today. Say so plainly instead of
            // leaking a Postgres foreign-key message or promising a false fix.
            const code =
              typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
            if (code === '23503') {
              Alert.alert(
                'Cannot delete this vehicle',
                'This vehicle cannot be deleted because it has refill history. ' +
                  'Keeping the vehicle preserves its fuel records and shared history.',
              );
              return;
            }
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
    // No screen background: the cream canvas is painted by `TabCanvas` in
    // `app/(tabs)/_layout.tsx`, which sits above this scene's safe-area and
    // tab-bar insets, so the cream reaches the physical top and bottom edges.
    <ScrollView
      ref={scrollRef}
      onScroll={tabBarScrollHandler}
      scrollEventThrottle={16}
      style={styles.flex}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vehicles</Text>
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
              <Ionicons name="close" size={18} color={GasTaColors.textSoft} />
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
            <View style={[styles.selectedVehicleChip, { backgroundColor: GasTaColors.forest }]}>
              <Text style={styles.selectedVehicleText}>
                {selectedCatalogEntry.brand} {selectedCatalogEntry.model} (
                {selectedCatalogEntry.year})
              </Text>
              <Pressable onPress={handleClearSelection} style={styles.clearButton}>
                <Ionicons name="close" size={16} color={GasTaColors.textOnForest} />
              </Pressable>
            </View>
          )}
          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map((entry) => (
                <Pressable
                  key={entry.id}
                  style={[styles.searchResultItem, { backgroundColor: TINT_BG }]}
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
            <Ionicons name="add" size={20} color={GasTaColors.forest} />
          </View>
          <Text style={styles.addActionLabel}>Add vehicle</Text>
          <Ionicons name="chevron-forward" size={16} color={GasTaColors.forest} />
        </Pressable>
      )}

      {vehicles.length === 0 ? (
        <EmptyState
          variant="canonical"
          icon="car-outline"
          title="No vehicles yet"
          message="Add your first vehicle to use it in the Trip Optimizer."
        />
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
                    <Ionicons name="car-outline" size={18} color={GasTaColors.forest} />
                  </View>
                  <View style={styles.vehicleCardTitles}>
                    <Text numberOfLines={1} style={styles.vehicleName}>
                      {v.nickname ?? `${v.brand} ${v.model}`}
                    </Text>
                    <Text numberOfLines={1} style={styles.vehicleMeta}>
                      {v.brand} {v.model} · {v.year} · {v.fuel_efficiency_km_per_liter} km/L
                    </Text>
                  </View>

                  {/* Header controls. Icon-only so they never crowd the vehicle
                      name on a 320-375px screen; both carry accessibility
                      labels. Sharing drives the panel's controlled expansion —
                      no sharing logic moved. */}
                  {showRefillForm || isEditingThis ? null : (
                    <View style={styles.cardHeadActions}>
                      <Pressable
                        accessibilityLabel="Share vehicle"
                        accessibilityRole="button"
                        accessibilityState={{ expanded: shareOpenId === v.id }}
                        hitSlop={8}
                        onPress={() => toggleShare(v.id)}
                        style={({ pressed }) => [
                          styles.cardHeadBtn,
                          pressed && styles.cardHeadBtnPressed,
                        ]}>
                        <Ionicons
                          name={shareOpenId === v.id ? 'chevron-up' : 'share-social-outline'}
                          size={17}
                          color={GasTaColors.forest}
                        />
                      </Pressable>
                      <View
                        ref={(node) => {
                          triggerNodes.current[v.id] = node;
                        }}
                        collapsable={false}>
                        <Pressable
                          accessibilityLabel="More vehicle actions"
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => openMenu(v, hasRefill)}
                          style={({ pressed }) => [
                            styles.cardHeadBtn,
                            pressed && styles.cardHeadBtnPressed,
                          ]}>
                          <Ionicons
                            name="ellipsis-vertical"
                            size={17}
                            color={GasTaColors.textSoft}
                          />
                        </Pressable>
                      </View>
                    </View>
                  )}
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

                {/* Sharing still expands inline in this same card, so the panel
                    visually stays connected to the vehicle it belongs to. It is
                    controlled by the header button above. */}
                {showRefillForm || isEditingThis ? null : (
                  <VehicleSharePanel
                    vehicleId={v.id}
                    ownerId={user.id}
                    expanded={shareOpenId === v.id}
                    onToggle={() => toggleShare(v.id)}
                  />
                )}

                {showRefillForm || isEditingThis ? null : (
                  <VehicleRefillPanel
                    currentUserId={user.id}
                    isOwner
                    onChanged={load}
                    vehicleFuelTypeId={v.fuel_type_id}
                    vehicleId={v.id}
                    vehicleLabel={v.nickname ?? `${v.brand} ${v.model}`}
                  />
                )}

                {isEditingThis ? (
                  <View style={styles.editingNote}>
                    <Ionicons name="pencil" size={13} color={GasTaColors.forest} />
                    <Text style={styles.editingNoteText}>
                      Editing above — tap Cancel to discard.
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      )}

      <Text style={styles.sectionLabel}>Shared with me</Text>
      {sharedVehicles.length === 0 ? (
        <EmptyState
          variant="canonical"
          icon="people-outline"
          title="Nothing shared yet"
          message="Vehicles shared with you will appear here."
        />
      ) : (
        sharedVehicles.map((sharedVehicle) => (
          <View key={sharedVehicle.vehicleId} style={styles.sharedRow}>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/shared-vehicle-history',
                  params: {
                    vehicleId: sharedVehicle.vehicleId,
                    vehicleLabel: `${sharedVehicle.brand} ${sharedVehicle.model}`,
                  },
                })
              }
              style={({ pressed }) => [styles.sharedRowMain, pressed && styles.pressedRow]}>
              <View style={styles.vehicleCardTitles}>
                <Text numberOfLines={1} style={styles.vehicleName}>
                  {sharedVehicle.brand} {sharedVehicle.model}
                </Text>
                {/* Role as a chip rather than trailing metadata. The role string
                    is rendered exactly as the data provides it — this is purely
                    presentation, and the colour must NOT be read as a permission
                    signal. */}
                <View
                  style={[
                    styles.roleChip,
                    sharedVehicle.role === 'Viewer' && styles.roleChipNeutral,
                  ]}>
                  <Text
                    style={[
                      styles.roleChipText,
                      sharedVehicle.role === 'Viewer' && styles.roleChipTextNeutral,
                    ]}>
                    {sharedVehicle.role}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={GasTaColors.textSoft} />
            </Pressable>
            <VehicleRefillPanel
              currentUserId={user.id}
              isOwner={false}
              onChanged={load}
              vehicleFuelTypeId={sharedVehicle.fuelTypeId}
              vehicleId={sharedVehicle.vehicleId}
              vehicleLabel={`${sharedVehicle.brand} ${sharedVehicle.model}`}
            />
          </View>
        ))
      )}

      {/* ------------------------------------------- vehicle overflow menu
          Rare/admin actions, anchored under the ellipsis that opened it.
          A transparent Modal with a tap-to-dismiss backdrop is used because it
          escapes the ScrollView's bounds on every platform, including web, with
          no new dependency. Each item calls the SAME handler the old inline
          action row used — no logic was duplicated or moved. */}
      <Modal
        animationType="fade"
        transparent
        visible={menuFor !== null}
        onRequestClose={closeMenu}>
        <Pressable style={styles.menuBackdrop} onPress={closeMenu} accessibilityLabel="Close menu">
          <View
            pointerEvents="box-none"
            style={[
              styles.menu,
              // Anchored under the measured ellipsis, clamped so the menu can
              // never run off the left edge on a narrow screen.
              menuAnchor
                ? {
                    top: menuAnchor.y + 30,
                    left: Math.max(GasTaSpacing.sm, menuAnchor.x + menuAnchor.width - MENU_WIDTH),
                  }
                : { top: 80, left: GasTaSpacing.lg },
            ]}>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Edit vehicle"
              onPress={() => {
                const target = menuFor;
                closeMenu();
                if (target) handleEditVehicle(target);
              }}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
              <Ionicons name="create-outline" size={16} color={GasTaColors.forestDark} />
              <Text style={styles.menuItemText}>Edit vehicle</Text>
            </Pressable>

            <View style={styles.menuDivider} />

            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel={
                menuHasRefill ? 'Update refill price' : 'Set refill price'
              }
              onPress={() => {
                const target = menuFor;
                if (!target) return;
                closeMenu();
                setEditingVehicleId(target.id);
                setEditLastRefillPrice(
                  target.last_refill_price != null ? String(target.last_refill_price) : '',
                );
              }}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
              <Ionicons name="cash-outline" size={16} color={GasTaColors.forestDark} />
              <Text style={styles.menuItemText}>
                {menuHasRefill ? 'Update refill price' : 'Set refill price'}
              </Text>
            </Pressable>

            <View style={styles.menuDivider} />

            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Delete vehicle"
              onPress={() => {
                const target = menuFor;
                closeMenu();
                if (target) handleDelete(target.id);
              }}
              style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}>
              <Ionicons name="trash-outline" size={16} color={palette.danger} />
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>Delete vehicle</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

    </ScrollView>
  );
}

/**
 * Faint forest tint, the same value the auth and Profile surfaces use. Replaces
 * the old `primarySoft` / `navySoft` green and blue-gray washes.
 */
const TINT_BG = 'rgba(1, 68, 33, 0.06)';

/** Layout rhythm. Matches the Home screen so both tabs read as one app. */
const SECTION_GAP = 28;
const SURFACE_PAD = 18;

/** Fixed menu width, so the anchor math can right-align it under the ellipsis. */
const MENU_WIDTH = 200;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    paddingHorizontal: GasTaSpacing.lg,
    paddingBottom: GasTaSpacing.xl,
  },
  header: {
    marginTop: GasTaSpacing.xl,
    marginBottom: SECTION_GAP,
  },
  headerTitle: {
    ...typeScale.pageTitle,
    color: GasTaColors.forestDark,
  },
  headerSubtitle: {
    ...typeScale.body,
    color: GasTaColors.textMuted,
    marginTop: GasTaSpacing.xs,
  },
  sectionLabel: {
    ...typeScale.label,
    color: GasTaColors.textSoft,
    textTransform: 'uppercase',
    marginTop: SECTION_GAP,
    marginBottom: GasTaSpacing.sm,
  },

  // Single primary action, replacing the always-visible form.
  addAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.md,
    paddingVertical: GasTaSpacing.md,
    paddingHorizontal: SURFACE_PAD,
    borderRadius: GasTaRadius.md,
    backgroundColor: GasTaColors.forest,
  },
  addActionPressed: {
    opacity: 0.85,
  },
  addActionIcon: {
    width: 32,
    height: 32,
    borderRadius: GasTaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.white,
  },
  addActionLabel: {
    flex: 1,
    color: GasTaColors.textOnForest,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },

  // Collapsible add/edit form. Flat surface — no blur, no gradient.
  formCard: {
    padding: SURFACE_PAD,
    borderRadius: GasTaRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.white,
  },
  formCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: GasTaSpacing.md,
  },
  formCardTitle: {
    color: GasTaColors.forestDark,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
  formClose: {
    padding: 2,
  },
  cancelEditBtn: {
    marginTop: GasTaSpacing.sm,
  },
  errorText: {
    color: palette.danger,
    fontSize: 12,
    marginTop: -GasTaSpacing.sm,
    marginBottom: GasTaSpacing.md,
  },

  selectedVehicleChip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: GasTaSpacing.md,
    borderRadius: GasTaRadius.md,
    marginBottom: GasTaSpacing.md,
  },
  selectedVehicleText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
    color: GasTaColors.textOnForest,
  },
  clearButton: {
    padding: GasTaSpacing.xs,
    marginLeft: GasTaSpacing.sm,
  },
  searchResults: {
    marginBottom: GasTaSpacing.md,
  },
  searchResultItem: {
    padding: GasTaSpacing.md,
    borderRadius: GasTaRadius.sm,
    marginBottom: GasTaSpacing.xs,
  },
  searchResultText: {
    color: GasTaColors.forestDark,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '600',
  },
  searchResultSubtext: {
    color: GasTaColors.textSoft,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  // Compact vehicle card — flat surface, hairline border, no shadow.
  vehicleCard: {
    padding: SURFACE_PAD,
    borderRadius: GasTaRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.white,
    marginBottom: GasTaSpacing.md,
  },
  vehicleCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.md,
  },
  vehicleIcon: {
    width: 36,
    height: 36,
    borderRadius: GasTaRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TINT_BG,
  },
  vehicleCardTitles: {
    flex: 1,
    minWidth: 0,
  },
  // Icon-only header controls so they never crowd the vehicle name on a
  // 320-375px screen. Both keep accessibility labels.
  cardHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  cardHeadBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GasTaRadius.sm,
  },
  cardHeadBtnPressed: {
    backgroundColor: TINT_BG,
  },

  // ---- vehicle overflow menu ----------------------------------------------
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 48, 25, 0.28)',
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    paddingVertical: 4,
    shadowColor: GasTaColors.forestDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    paddingHorizontal: GasTaSpacing.md,
    paddingVertical: 11,
  },
  menuItemPressed: {
    backgroundColor: TINT_BG,
  },
  menuItemText: {
    ...typeScale.bodySmall,
    fontWeight: '600',
    color: GasTaColors.forestDark,
  },
  menuItemDanger: {
    color: palette.danger,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GasTaColors.glassBorderSubtle,
    marginHorizontal: GasTaSpacing.md,
  },
  vehicleName: {
    color: GasTaColors.forestDark,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  vehicleMeta: {
    color: GasTaColors.textSoft,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 1,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: GasTaColors.glassBorderSubtle,
    marginVertical: GasTaSpacing.md,
  },
  refillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GasTaSpacing.md,
  },
  // ---- role chip (presentation only; not a permission signal) -------------
  roleChip: {
    alignSelf: 'flex-start',
    marginTop: GasTaSpacing.xs,
    paddingHorizontal: GasTaSpacing.sm,
    paddingVertical: 2,
    borderRadius: GasTaRadius.pill,
    backgroundColor: TINT_BG,
  },
  roleChipNeutral: {
    // Viewer reads as deliberately quieter than the contributing roles.
    backgroundColor: GasTaColors.creamDark,
  },
  roleChipText: {
    ...typeScale.label,
    fontSize: 11,
    letterSpacing: 0.2,
    color: GasTaColors.forest,
  },
  roleChipTextNeutral: {
    color: GasTaColors.textMuted,
  },

  // ---- last refill band ---------------------------------------------------
  refillLabel: {
    color: GasTaColors.textSoft,
    fontSize: 12,
    lineHeight: 16,
  },
  refillValue: {
    flexShrink: 1,
    color: GasTaColors.forestDark,
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
    marginTop: GasTaSpacing.md,
    paddingTop: GasTaSpacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.glassBorderSubtle,
  },
  inlineFormActions: {
    flexDirection: 'row',
    gap: GasTaSpacing.sm,
  },
  inlineFormAction: {
    flex: 1,
  },
  editingNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: GasTaSpacing.sm,
    padding: GasTaSpacing.sm,
    borderRadius: GasTaRadius.sm,
    backgroundColor: TINT_BG,
  },
  editingNoteText: {
    flex: 1,
    color: GasTaColors.forestDark,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  // Pressed state for the shared-vehicle row. The former `cardActions` /
  // `cardAction*` styles are gone: those three always-visible owner actions now
  // live in the overflow menu, and the handlers they called are unchanged.
  pressedRow: {
    backgroundColor: TINT_BG,
  },
  sharedRow: {
    paddingVertical: GasTaSpacing.md,
    paddingHorizontal: SURFACE_PAD,
    borderRadius: GasTaRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    backgroundColor: GasTaColors.white,
    marginBottom: GasTaSpacing.sm,
  },
  sharedRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.md,
  },
});
