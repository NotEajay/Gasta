import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import VehicleSharePanel from '@/components/VehicleSharePanel';
import VehicleRefillPanel from '@/components/vehicle/VehicleRefillPanel';
import HideWhenBlurred from '@/components/navigation/HideWhenBlurred';
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
  archiveVehicle,
  createVehicle,
  deleteVehicle,
  fetchArchivedVehicles,
  fetchFuelTypeIdByCode,
  fetchSharedVehicles,
  fetchVehicleCatalog,
  fetchVehicles,
  getVehicleHistoryStatus,
  restoreVehicle,
  updateVehicle,
  updateVehicleLastRefill,
  type VehicleHistoryState,
} from '@/lib/services/vehicles';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { SharedVehicle, Vehicle, VehicleCatalogEntry } from '@/types';

export default function VehiclesScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const tabBarScrollHandler = useTabBarScrollHandler();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  // The add/edit form is collapsed by default so saved vehicles lead the page.
  const [formOpen, setFormOpen] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [archivedVehicles, setArchivedVehicles] = useState<Vehicle[]>([]);
  const [sharedVehicles, setSharedVehicles] = useState<SharedVehicle[]>([]);
  const [catalog, setCatalog] = useState<VehicleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [destructiveBusy, setDestructiveBusy] = useState(false);

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
  // menuVisible is separate from menuFor so the Modal mounts only after the
  // anchor measurement resolves (no one-frame jump from the fallback corner).
  const [menuVisible, setMenuVisible] = useState(false);
  // Mirror of menuFor for probe callbacks (reading state inside .then is
  // fine; calling setState inside another setState updater is not).
  const menuForRef = useRef<Vehicle | null>(null);
  // Gated destructive action: while history is unresolved ('idle'/'loading'/
  // 'unknown') NO actionable Delete is ever shown — the safe direction is
  // Archive. Only an explicit 'no-history' unlocks permanent delete, because
  // FK 23503 only guards refill history; trip/saved-trip/share history would
  // be silently nulled or cascade-wiped by a premature delete.
  const [menuHistoryState, setMenuHistoryState] = useState<VehicleHistoryState>('idle');
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; width: number } | null>(
    null,
  );
  const triggerNodes = useRef<Record<string, ComponentRef<typeof View> | null>>({});
  // Guards the async probe against a closed menu / a second menu opening:
  // only the latest probe for the currently open vehicle may write state.
  const menuProbeSeq = useRef(0);

  const toggleShare = useCallback((vehicleId: string) => {
    setShareOpenId((current) => (current === vehicleId ? null : vehicleId));
  }, []);

  /**
   * Opens the overflow for one vehicle, anchored under its own ellipsis.
   * Measurement goes through a plain View wrapper because this project's
   * react-native type surface does not expose `measureInWindow` on Pressable —
   * the same constraint RefillSplitSheet already works around.
   *
   * SAFETY: the destructive slot starts in 'loading' with NO actionable
   * Delete. The probe resolves to has-history / no-history / unknown; only
   * 'no-history' unlocks Delete. 'unknown' (RPC failure, RLS-truncated
   * fallback, malformed row) resolves to Archive, never Delete.
   */
  const openMenu = useCallback((vehicle: Vehicle) => {
    const seq = menuProbeSeq.current + 1;
    menuProbeSeq.current = seq;
    // Measure BEFORE showing the modal: menuVisible stays false until the
    // anchor resolves, so the first painted frame is already positioned and
    // there is no jump from the fallback corner.
    menuForRef.current = vehicle;
    setMenuFor(vehicle);
    setMenuAnchor(null);
    setMenuVisible(false);
    setMenuHistoryState('loading');
    const node = triggerNodes.current[vehicle.id];
    if (node) {
      node.measureInWindow((x, y, width) => {
        if (menuProbeSeq.current !== seq) return;
        setMenuAnchor({ x, y, width });
        setMenuVisible(true);
      });
    } else {
      // Unmeasurable trigger (should not happen): still open without a jump
      // by falling back to the default corner position.
      setMenuVisible(true);
    }
    void getVehicleHistoryStatus(vehicle.id)
      .then((status) => {
        // Direct guarded setState — never nested inside another updater.
        // (Calling setState inside a setState updater is a purity violation:
        // React may double-invoke or discard updaters, which previously left
        // menuHistoryState stuck at 'loading' so Delete never appeared.)
        if (menuProbeSeq.current !== seq) return;
        if (menuForRef.current?.id !== vehicle.id) return;
        setMenuHistoryState(status.state);
      })
      .catch(() => {
        // getVehicleHistoryStatus itself never throws for history failures
        // (it returns 'unknown'), so this only guards truly unexpected
        // rejections — still safe: unknown → Archive.
        if (menuProbeSeq.current !== seq) return;
        if (menuForRef.current?.id !== vehicle.id) return;
        setMenuHistoryState('unknown');
      });
  }, []);

  const closeMenu = useCallback(() => {
    menuProbeSeq.current += 1;
    menuForRef.current = null;
    setMenuVisible(false);
    setMenuFor(null);
    setMenuHistoryState('idle');
    setMenuAnchor(null);
  }, []);

  // Leaving Vehicles (tab switch / stack push) must never leave a stale
  // overlay behind: close the menu, clear the anchor, and invalidate any
  // in-flight probe. Vehicle data and form state are intentionally kept.
  useFocusEffect(
    useCallback(() => {
      return () => {
        menuProbeSeq.current += 1;
        menuForRef.current = null;
        setMenuVisible(false);
        setMenuFor(null);
        setMenuHistoryState('idle');
        setMenuAnchor(null);
      };
    }, []),
  );

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

      // Archived section is best-effort: it only exists after the archive
      // migration is applied, and must never block the active list.
      try {
        setArchivedVehicles(await fetchArchivedVehicles(user.id));
      } catch {
        setArchivedVehicles([]);
      }

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

  const handleDelete = (vehicleId: string, historyState: VehicleHistoryState) => {
    closeMenu();
    // Vehicles with dependent history — or UNKNOWN history — are archived,
    // never hard-deleted, so refill, trip, expense and shared rows stay
    // intact. Only an explicit 'no-history' unlocks permanent delete, because
    // FK 23503 guards refills only: trip/saved-trip history would be nulled
    // (SET NULL) and share history cascade-wiped by a premature delete.
    if (historyState !== 'no-history') {
      Alert.alert(
        'Archive vehicle?',
        'This vehicle will be removed from your active vehicles, but its refill, trip, expense, and shared history will be preserved.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Archive',
            style: 'destructive',
            onPress: async () => {
              if (destructiveBusy) return;
              setDestructiveBusy(true);
              try {
                await archiveVehicle(vehicleId);
                await load();
                Alert.alert(
                  'Archived',
                  'Vehicle archived. Keeps refill, trip, expense, and shared history.',
                );
              } catch (e) {
                Alert.alert('Error', e instanceof Error ? e.message : 'Failed to archive');
              } finally {
                setDestructiveBusy(false);
              }
            },
          },
        ],
      );
      return;
    }
    Alert.alert('Delete vehicle', 'Remove this vehicle from your profile? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete permanently',
        style: 'destructive',
        onPress: async () => {
          if (destructiveBusy) return;
          setDestructiveBusy(true);
          try {
            await deleteVehicle(vehicleId);
            await load();
          } catch (e) {
            // Race-condition backstop ONLY: FK 23503 guards refill history, so a
            // 23503 here means a refill landed between the probe and the tap.
            // Trip/saved-trip/share deletes do NOT raise — that is exactly why
            // Delete is gated on an explicit 'no-history' above and never on
            // this handler. Never leak SQL — offer the archive path instead.
            const code =
              typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
            if (code === '23503') {
              Alert.alert(
                'Cannot delete permanently',
                'This vehicle now has history and can no longer be permanently deleted. Archive it instead.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Archive vehicle',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await archiveVehicle(vehicleId);
                        await load();
                        Alert.alert(
                          'Archived',
                          'Vehicle archived. Keeps refill, trip, expense, and shared history.',
                        );
                      } catch (archiveError) {
                        Alert.alert(
                          'Error',
                          archiveError instanceof Error ? archiveError.message : 'Failed to archive',
                        );
                      }
                    },
                  },
                ],
              );
              return;
            }
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to delete');
          } finally {
            setDestructiveBusy(false);
          }
        },
      },
    ]);
  };

  const handleRestore = (vehicleId: string, label: string) => {
    Alert.alert('Restore vehicle?', `Return "${label}" to your active vehicles?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restore',
        onPress: async () => {
          setRestoringId(vehicleId);
          try {
            await restoreVehicle(vehicleId);
            await load();
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Failed to restore');
          } finally {
            setRestoringId(null);
          }
        },
      },
    ]);
  };

  /**
   * Archive is the safe destructive direction, so it stays
   * actionable both while history is unresolved (loading/idle)
   * and once it resolves to has-history / unknown. Defined
   * once so the fixed two-row menu slot can render it in
   * either row without duplicating markup.
   */
  const archiveAction = (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel="Archive vehicle"
      onPress={() => {
        const target = menuFor;
        closeMenu();
        if (target) handleDelete(target.id, 'has-history');
      }}
      style={({ pressed }) => [
        styles.menuItem,
        styles.menuSlotRow,
        pressed && styles.menuItemPressed,
      ]}>
      <Ionicons name="archive-outline" size={16} color={palette.danger} />
      <Text style={[styles.menuItemText, styles.menuItemDanger]} numberOfLines={1}>
        Archive vehicle
      </Text>
    </Pressable>
  );

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
    <HideWhenBlurred>
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
                          onPress={() => openMenu(v)}
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
          action row used — no logic was duplicated or moved.
          Lifecycle: menuVisible is set ONLY after measureInWindow
          resolves, so the first painted frame is already anchored
          (no corner jump). The destructive slot is a fixed
          two-row layout: the probe resolving swaps row content
          in place, so the menu never resizes mid-open. */}
      <Modal
        animationType="fade"
        transparent
        visible={menuVisible}
        onRequestClose={closeMenu}>
        <Pressable style={styles.menuBackdrop} onPress={closeMenu} accessibilityLabel="Close menu">
          <View
            pointerEvents="box-none"
            style={[
              styles.menu,
              // Anchor is always set before menuVisible, but keep the guarded
              // fallback so a missed measurement can never crash layout.
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
                menuFor?.last_refill_price != null ? 'Update refill price' : 'Set refill price'
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
                {menuFor?.last_refill_price != null ? 'Update refill price' : 'Set refill price'}
              </Text>
            </Pressable>

            <View style={styles.menuDivider} />

            {/* Destructive slot — gated on resolved history and
                laid out as a FIXED two-row block: a primary
                action row plus a context row, each with a
                fixed min-height and capped line count. When
                the history probe resolves, row content swaps
                in place, so the open menu never resizes or
                jumps. While loading/idle, Delete is NEVER
                actionable — the menu shows a non-actionable
                status row plus Archive (the safe direction).
                Only an explicit 'no-history' renders the
                Delete action; has-history and unknown both
                render Archive. */}
            <View style={styles.menuDestructiveSlot}>
              {menuHistoryState === 'no-history' ? (
                <Pressable
                  accessibilityRole="menuitem"
                  accessibilityLabel="Delete vehicle"
                  onPress={() => {
                    const target = menuFor;
                    closeMenu();
                    if (target) handleDelete(target.id, 'no-history');
                  }}
                  style={({ pressed }) => [
                    styles.menuItem,
                    styles.menuSlotRow,
                    pressed && styles.menuItemPressed,
                  ]}>
                  <Ionicons name="trash-outline" size={16} color={palette.danger} />
                  <Text style={[styles.menuItemText, styles.menuItemDanger]} numberOfLines={1}>
                    Delete vehicle
                  </Text>
                </Pressable>
              ) : menuHistoryState === 'loading' || menuHistoryState === 'idle' ? (
                <View
                  accessibilityRole="text"
                  accessibilityLabel="Checking vehicle history"
                  style={[styles.menuItem, styles.menuSlotRow, styles.menuItemDisabled]}>
                  <Ionicons name="hourglass-outline" size={16} color={GasTaColors.textMuted} />
                  <Text style={[styles.menuItemText, styles.menuItemMuted]} numberOfLines={1}>
                    Checking vehicle history…
                  </Text>
                </View>
              ) : (
                archiveAction
              )}

              {menuHistoryState === 'no-history' ? (
                <View
                  accessibilityRole="text"
                  accessibilityLabel="No refill, trip, or shared history"
                  style={[styles.menuItem, styles.menuSlotContextRow]}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={16}
                    color={GasTaColors.textMuted}
                  />
                  <Text style={styles.menuHintText} numberOfLines={2}>
                    No refill, trip, or shared history
                  </Text>
                </View>
              ) : menuHistoryState === 'loading' || menuHistoryState === 'idle' ? (
                archiveAction
              ) : (
                <View
                  accessibilityRole="text"
                  accessibilityLabel="Keeps refill, trip, expense, and shared history."
                  style={[styles.menuItem, styles.menuSlotContextRow]}>
                  <Ionicons
                    name="information-circle-outline"
                    size={16}
                    color={GasTaColors.textMuted}
                  />
                  <Text style={styles.menuHintText} numberOfLines={2}>
                    Keeps refill, trip, expense, and shared history.
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ------------------------------------------- archived vehicles
          Owner-only management section. Archived rows never appear in active
          selectors; Restore returns the row to active use. */}
      {archivedVehicles.length > 0 ? (
        <View style={styles.archivedSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={archivedOpen ? 'Hide archived vehicles' : 'Show archived vehicles'}
            onPress={() => setArchivedOpen((open) => !open)}
            style={styles.archivedToggle}>
            <Text style={styles.archivedTitle}>Archived vehicles ({archivedVehicles.length})</Text>
            <Ionicons
              name={archivedOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={GasTaColors.textSoft}
            />
          </Pressable>
          {archivedOpen
            ? archivedVehicles.map((v) => (
                <View key={v.id} style={styles.archivedCard}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={styles.vehicleName}>
                      {v.nickname ?? `${v.brand} ${v.model}`}
                    </Text>
                    <Text numberOfLines={1} style={styles.vehicleMeta}>
                      {v.brand} {v.model} · {v.year}
                      {v.archived_at ? ` · archived ${formatDate(v.archived_at)}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Restore ${v.nickname ?? `${v.brand} ${v.model}`}`}
                    disabled={restoringId === v.id}
                    onPress={() => handleRestore(v.id, v.nickname ?? `${v.brand} ${v.model}`)}
                    style={({ pressed }) => [
                      styles.archivedRestoreBtn,
                      pressed && styles.cardHeadBtnPressed,
                    ]}>
                    <Text style={styles.archivedRestoreText}>
                      {restoringId === v.id ? 'Restoring…' : 'Restore'}
                    </Text>
                  </Pressable>
                </View>
              ))
            : null}
        </View>
      ) : null}

    </ScrollView>
    </HideWhenBlurred>
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
  menuItemDisabled: {
    opacity: 0.7,
  },
  menuItemMuted: {
    color: GasTaColors.textMuted,
    fontWeight: '600',
  },
  // Fixed two-row destructive slot. Both rows keep a
  // constant height (capped line counts included) so the
  // menu never resizes when menuHistoryState resolves.
  menuDestructiveSlot: {},
  menuSlotRow: {
    minHeight: 44,
    justifyContent: 'center',
  },
  menuSlotContextRow: {
    minHeight: 48,
    justifyContent: 'center',
  },
  menuHintText: {
    ...typeScale.label,
    fontSize: 11,
    color: GasTaColors.textMuted,
    flex: 1,
  },
  archivedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  archivedTitle: {
    ...typeScale.bodySmall,
    fontWeight: '700',
    color: GasTaColors.forestDark,
  },
  archivedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GasTaSpacing.sm,
    marginTop: GasTaSpacing.sm,
    paddingTop: GasTaSpacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: GasTaColors.glassBorderSubtle,
  },
  archivedRestoreBtn: {
    paddingHorizontal: GasTaSpacing.md,
    paddingVertical: 8,
    borderRadius: GasTaRadius.pill,
    backgroundColor: TINT_BG,
  },
  archivedRestoreText: {
    ...typeScale.label,
    fontWeight: '700',
    color: GasTaColors.forest,
  },
  archivedSection: {
    marginTop: SECTION_GAP,
    backgroundColor: GasTaColors.white,
    borderRadius: GasTaRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GasTaColors.glassBorderSubtle,
    padding: SURFACE_PAD,
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
