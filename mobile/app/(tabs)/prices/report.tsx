import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/Themed';
import BrandMark from '@/components/ui/BrandMark';
import { fetchReportStation, type ReportStation } from '@/lib/services/stationDirectory';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import ChipSelect from '@/components/ui/ChipSelect';
import SubPageHeader from '@/components/ui/SubPageHeader';
import FormSection from '@/components/ui/FormSection';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { VERIFY_CONFIRMATIONS_REQUIRED } from '@/constants/communityReports';
import { DOE_REGIONS, REGION_CENTROIDS, type DoeRegionCode } from '@/constants/regions';
import { GasTaColors, palette, radii, spacing } from '@/constants/Theme';
import { useAuth } from '@/context/AuthProvider';
import { formatCurrency } from '@/lib/format';
import {
  createFuelStation,
  findOilCompanyByName,
  fetchFuelStationsByRegion,
  fetchOilCompanies,
  getIndependentCompanyId,
  submitCommunityReport,
  type FuelStationOption,
} from '@/lib/services/communityReports';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

type SubmittedReport = {
  region: string;
  brand: string;
  station: string;
  fuel: string;
  price: number;
};

export default function ReportPriceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    station_id?: string;
    station_name?: string;
    station_address?: string;
    brand?: string;
    fuel_type?: string;
    region?: string;
    source?: string;
    company_slug?: string;
    area?: string;
  }>();
  const { user, loading: authLoading } = useAuth();
  const initialRegion =
    typeof params.region === 'string' &&
    DOE_REGIONS.some((option) => option.code === params.region)
      ? (params.region as DoeRegionCode)
      : 'NCR';
  const initialFuelType =
    typeof params.fuel_type === 'string' &&
    DOE_FUEL_TYPES.some((option) => option.code === params.fuel_type)
      ? (params.fuel_type as DoeFuelTypeCode)
      : 'RON_91';
  const [region, setRegion] = useState<DoeRegionCode>(initialRegion);
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>(initialFuelType);
  const [stations, setStations] = useState<FuelStationOption[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; slug: string }[]>([]);
  const selectedStationId = typeof params.station_id === 'string' ? params.station_id : null;
  const [selectedStation, setSelectedStation] = useState<ReportStation | null>(null);
  const [listedStationId, setListedStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState('');
  const [stationType, setStationType] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedReport | null>(null);
  const submitInFlight = useRef(false);
  const [priceFocused, setPriceFocused] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const priceFieldRef = useRef<View>(null);
  const notesFieldRef = useRef<View>(null);
  const focusedField = useRef<View | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const revealField = useCallback((target: View | null) => {
    focusedField.current = target;
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    if (!target || !Keyboard.isVisible()) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const scroll = scrollRef.current;
      if (!scroll || focusedField.current !== target) return;
      scroll.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => {
        target.measureInWindow((_fieldX, fieldTop, _fieldWidth, fieldHeight) => {
          if (focusedField.current !== target || !Keyboard.isVisible()) return;
          const bottom = Math.min(top + height, Keyboard.metrics()?.screenY ?? top + height) - spacing.md;
          const overflow = fieldTop + fieldHeight - bottom;
          if (overflow > 0) scroll.scrollTo({ y: scrollOffset.current + overflow, animated: true });
        });
      });
    });
  }, []);
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => revealField(focusedField.current));
    const hidden = Keyboard.addListener('keyboardDidHide', () => { focusedField.current = null; });
    return () => {
      shown.remove(); hidden.remove();
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    };
  }, [revealField]);
  const changeStation = () => {
    Keyboard.dismiss();
    if (params.source === 'community-general') {
      router.navigate({ pathname: '/(tabs)/prices/community', params: {
        report_flow: 'community-general', report_company: params.company_slug ?? '',
        report_region: region, report_area: params.area ?? '', report_request: String(Date.now()),
      } });
    } else if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/prices');
  };

  const loadStations = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [list, brands, picked] = await Promise.all([
        selectedStationId ? Promise.resolve([] as FuelStationOption[]) : fetchFuelStationsByRegion(region),
        fetchOilCompanies(),
        selectedStationId ? fetchReportStation(selectedStationId) : Promise.resolve(null),
      ]);
      setStations(list);
      setCompanies(brands);
      setSelectedStation(picked);
      if (picked) {
        setListedStationId(picked.id);
        setStationName(picked.name);
        setCompanyId(picked.company.id);
        setStationType(picked.brand_label || picked.company.name);
      } else {
        setListedStationId((prev) => (list.some((s) => s.id === prev) ? prev : null));
      }
      setFormError(null);
    } catch {
      setFormError(selectedStationId ? "We couldn't load the selected station. Please choose the station again." : "We couldn't load stations. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [region, selectedStationId]);

  useEffect(() => {
    setLoading(true);
    loadStations();
  }, [loadStations]);

  useEffect(() => {
    if (selectedStationId) return;
    if (typeof params.brand === 'string' && params.brand.trim() && !stationName) {
      const company = companies.find(
        (candidate) =>
          candidate.name.toLowerCase() === params.brand?.trim().toLowerCase() ||
          candidate.slug.toLowerCase() === params.brand?.trim().toLowerCase()
      );
      setStationType(company?.name ?? params.brand.trim());
      setCompanyId(company?.id ?? null);
    }
  }, [companies, params.brand, params.station_id, selectedStationId, stationName, stations]);

  const applyListedStation = (id: string) => {
    const station = stations.find((s) => s.id === id);
    setListedStationId(id);
    if (!station) return;
    setStationName(station.name);
    setCompanyId(station.oil_company.id);
    setStationType(station.brand_label || station.oil_company.name);
  };

  const handleSubmit = async () => {
    if (submitInFlight.current) return;
    if (!user) {
      router.push('/login');
      return;
    }

    if (selectedStationId && !selectedStation) {
      setFormError("We couldn't load the selected station. Please choose the station again.");
      return;
    }

    const name = stationName.trim();
    const brand = stationType.trim();
    const priceNum = parseFloat(price);
    setFormError(null);

    if (!brand && !companyId) {
      setFormError('Type the brand (Petron, Shell, and so on) or pick one.');
      return;
    }
    if (!name) {
      setFormError('Type the station name, or pick one from the list.');
      return;
    }
    if (!fuelType) {
      setFormError('Choose the fuel grade you paid for.');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setFormError('Enter a valid price per liter.');
      return;
    }

    submitInFlight.current = true;
    setSubmitting(true);
    try {
      const { data: fuelRow, error: fuelError } = await supabase
        .from('fuel_types')
        .select('id')
        .eq('code', fuelType)
        .single();
      if (fuelError) {
        setFormError("We couldn't load this fuel type. Please try again.");
        return;
      }

      const knownId =
        companyId ?? (brand ? await findOilCompanyByName(brand) : null);
      const isCatalogBrand = Boolean(knownId);
      const oilCompanyId = knownId ?? (await getIndependentCompanyId());
      const brandLabel = isCatalogBrand ? null : brand;

      const match = stations.find(
        (s) => s.name.trim().toLowerCase() === name.toLowerCase()
      );
      const stationId =
        selectedStation?.id ??
        listedStationId ??
        match?.id ??
        (await createFuelStation({
          name,
          oilCompanyId,
          regionCode: region,
          latitude: REGION_CENTROIDS[region].latitude,
          longitude: REGION_CENTROIDS[region].longitude,
          brandLabel,
        }));

      await submitCommunityReport({
        stationId,
        fuelTypeId: fuelRow.id,
        price: priceNum,
        notes: notes.trim() || undefined,
      });

      const regionLabel = DOE_REGIONS.find((r) => r.code === region)?.name ?? region;
      const fuelLabel = DOE_FUEL_TYPES.find((f) => f.code === fuelType)?.name ?? fuelType;
      setSubmitted({
        region: regionLabel,
        brand: brand || 'Independent',
        station: name,
        fuel: fuelLabel,
        price: priceNum,
      });
    } catch {
      setFormError("We couldn't submit your report right now. Please try again.");
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitted(null);
    setFormError(null);
    setStationType(selectedStation ? selectedStation.brand_label || selectedStation.company.name : '');
    setCompanyId(selectedStation?.company.id ?? null);
    setListedStationId(selectedStation?.id ?? null);
    setStationName(selectedStation?.name ?? '');
    setPrice('');
    setNotes('');
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
    label: `${s.name} (${s.brand_label || s.oil_company.name})`,
  }));

  /*
   * Per-field errors, derived from exactly the checks `handleSubmit` already
   * runs. The order here mirrors the submit order (brand -> station -> price),
   * and only the first failing check surfaces, so this is presentation of the
   * existing rules -- no validation rule is added, removed, or reordered.
   */
  const trimmedName = stationName.trim();
  const trimmedBrand = stationType.trim();
  const hasBrand = Boolean(trimmedBrand || companyId);
  const priceNum = parseFloat(price);
  const priceInvalid = !Number.isFinite(priceNum) || priceNum <= 0;

  const brandError =
    formError && !hasBrand ? 'Type the brand (Petron, Shell, and so on) or pick one.' : undefined;
  const stationError =
    formError && hasBrand && !trimmedName
      ? 'Type the station name, or pick one from the list.'
      : undefined;
  const priceError =
    formError && hasBrand && trimmedName && priceInvalid
      ? 'Enter a valid price per liter.'
      : undefined;

  const StationContainer = selectedStationId ? View : FormSection;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
      scrollEventThrottle={16}
      style={styles.flex}
      contentContainerStyle={styles.padding}>
      <SubPageHeader
        module="community"
        title={selectedStationId ? "Report station price" : "Report a price"}
        subtitle={selectedStationId ? "Share the price you observed at this station." : "Help drivers see more recent fuel prices."}
      />

      {/* WHERE */}
      {/*
        Section heads get a small fuel mark and a pale forest rule so the form
        reads as a fuel report rather than a generic form. `FormSection` is
        shared, so the identity is added around it instead of changing it.
      */}
      {selectedStationId ? <Text style={styles.fieldLabel}>Selected station</Text> : <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <MaterialCommunityIcons name="map-marker-outline" size={14} color={GasTaColors.forest} />
        </View>
        <View style={styles.sectionHeadCopy}>
          <Text style={styles.sectionTitle}>Where</Text>
          <Text style={styles.sectionHint}>
            Region, brand, and the station you filled up at.
          </Text>
        </View>
      </View>}
      <StationContainer style={selectedStationId ? styles.selectedCard : styles.formBlock}>
        {selectedStationId ? (
          selectedStation ? <View style={styles.stationDetails}>
            <View style={styles.stationHeading}>
              <BrandMark brand={selectedStation.company.name} slug={selectedStation.company.slug} size="sm" />
              <View style={{ flex: 1 }}><Text style={styles.stationName}>{selectedStation.name}</Text><Text style={styles.sectionHint}>{selectedStation.brand_label || selectedStation.company.name}</Text></View>
              <MaterialCommunityIcons name="lock-outline" size={16} color={GasTaColors.forestMuted} />
            </View>
            {selectedStation.address ? <View style={styles.stationHeading}><MaterialCommunityIcons name="map-marker-outline" size={15} color={GasTaColors.forestMuted} /><Text style={styles.stationAddress}>{selectedStation.address}</Text></View> : null}
            <View style={styles.stationFooter}>
              <Text style={styles.sectionHint}>{DOE_REGIONS.find((item) => item.code === region)?.name}</Text>
              {selectedStation.source_type === 'official_directory' ? <Text style={styles.provenance}>Official directory</Text> : null}
            </View>
            <Pressable accessibilityRole="button" onPress={changeStation} style={styles.changeStation}><Text style={styles.changeStationText}>Change station</Text></Pressable>
          </View> : <View style={styles.stationDetails}>
            <Text style={styles.stationAddress}>We couldn't load the selected station. Please choose the station again.</Text>
            <PrimaryButton label="Change station" variant="secondary" onPress={changeStation} />
            <PrimaryButton label="Try again" variant="secondary" onPress={() => { setLoading(true); void loadStations(); }} />
          </View>
        ) : <>
        <ChipSelect
          label="Region"
          options={DOE_REGIONS.map((r) => ({ value: r.code, label: r.name }))}
          value={region}
          onChange={setRegion}
          module="community"
        />
        <LabeledInput
          label="Brand / station type"
          value={stationType}
          error={brandError}
          onChangeText={(text) => {
            setStationType(text);
            const match = companies.find((c) => c.name.toLowerCase() === text.trim().toLowerCase());
            setCompanyId(match?.id ?? null);
            setListedStationId(null);
          }}
          placeholder="e.g. Petron, Shell, PTT, Flying V"
          autoCapitalize="words"
        />
        {companies.length > 0 ? (
          <ChipSelect
            label="Or pick a known brand"
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
            value={companyId}
            onChange={(id) => {
              setCompanyId(id);
              const brand = companies.find((c) => c.id === id);
              if (brand) setStationType(brand.name);
            }}
            module="community"
          />
        ) : null}
        <LabeledInput
          label="Station"
          value={stationName}
          error={stationError}
          onChangeText={(text) => {
            setStationName(text);
            setListedStationId(null);
          }}
          placeholder="e.g. PTT Camarin Road Caloocan"
          autoCapitalize="words"
        />
        {stationOptions.length > 0 ? (
          <ChipSelect
            label="Or pick a listed station"
            options={stationOptions}
            value={listedStationId}
            onChange={applyListedStation}
            module="community"
          />
        ) : (
          <Text style={styles.hint}>
            New stations are saved only for this region. They will not appear in other regions.
          </Text>
        )}
        </>}
      </StationContainer>

      <View style={styles.expectRow}>
        <MaterialCommunityIcons name="shield-check-outline" size={18} color={GasTaColors.forest} />
        <Text style={styles.expectText}>Your report will appear as Unverified until {VERIFY_CONFIRMATIONS_REQUIRED} other drivers confirm the price.</Text>
      </View>

      <View>
        <ChipSelect
          label="Fuel type"
          options={DOE_FUEL_TYPES.map((f) => ({ value: f.code, label: f.name }))}
          value={fuelType}
          onChange={setFuelType}
          module="community"
        />
      </View>

      <View ref={priceFieldRef} collapsable={false} style={styles.priceSection}>
        <Text style={styles.priceLabel}>OBSERVED PRICE</Text>
        <View style={[styles.priceInputRow, priceFocused && styles.priceInputFocused, priceError && styles.priceInputError]}>
          <Text style={styles.priceUnit}>₱</Text>
          <TextInput accessibilityLabel="Observed price per liter" value={price} onChangeText={setPrice}
            onFocus={() => { setPriceFocused(true); revealField(priceFieldRef.current); }} onBlur={() => setPriceFocused(false)}
            keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={GasTaColors.textSoft} style={styles.priceInput} />
          <Text style={styles.priceUnit}>/ L</Text>
        </View>
        {priceError ? <Text style={styles.fieldError}>{priceError}</Text> : null}
      </View>

      <View ref={notesFieldRef} collapsable={false}>
        <LabeledInput label="Notes (optional)" value={notes} onChangeText={setNotes}
          onFocus={() => revealField(notesFieldRef.current)} multiline
          placeholder="Cash price, promo, landmark, or other useful detail"
          style={styles.notesInput} />
      </View>

      {/* Non-field failures (fuel-type lookup, submit errors) still surface as
          a single notice; field-level messages render inline above. */}
      {formError && !brandError && !stationError && !priceError ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
          <Text style={styles.errorText}>{formError}</Text>
        </View>
      ) : null}

      <Pressable accessibilityRole="button" accessibilityLabel={submitting ? 'Submitting…' : 'Submit report'}
        accessibilityState={{ disabled: submitting || (!!selectedStationId && !selectedStation), busy: submitting }}
        onPress={handleSubmit} disabled={submitting || (!!selectedStationId && !selectedStation)}
        style={({ pressed }) => [styles.submitButton, pressed && styles.submitPressed, (submitting || (!!selectedStationId && !selectedStation)) && styles.submitDisabled]}>
        {submitting ? <ActivityIndicator color={GasTaColors.white} /> : <MaterialCommunityIcons name="send-outline" size={18} color={GasTaColors.white} />}
        <Text style={styles.submitLabel}>{submitting ? 'Submitting…' : 'Submit report'}</Text>
      </Pressable>

      <Modal
        visible={submitted !== null}
        transparent
        animationType="fade"
        onRequestClose={resetForm}>
        <Pressable style={styles.modalBackdrop} onPress={resetForm}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.successBadge}>
              <MaterialCommunityIcons name="shield-check-outline" size={25} color={GasTaColors.forest} />
            </View>
            <Text style={styles.successTitle}>
              Submitted for community verification
            </Text>
            <Text style={styles.successBody}>
              GasTa hasn&apos;t verified this yet. It appears as Unverified until{' '}
              {VERIFY_CONFIRMATIONS_REQUIRED} other drivers confirm the price.
            </Text>
            {submitted ? (
              <View style={styles.summary}>
                <Text style={styles.unverifiedBadge}>Unverified</Text>
                <Text style={styles.summaryLine}>{submitted.station}</Text>
                <Text style={styles.summaryMeta}>
                  {submitted.brand} · {submitted.fuel} · {submitted.region}
                </Text>
                <Text style={styles.summaryPrice}>
                  {formatCurrency(submitted.price)}/L
                </Text>
              </View>
            ) : null}
            <PrimaryButton
              label="Back to Fuel Prices"
              onPress={() => {
                resetForm();
                router.replace('/(tabs)/prices');
              }}
              style={styles.successBtn}
            />
            <PrimaryButton label="Report another" variant="secondary" onPress={resetForm} />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: GasTaColors.creamLight },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: GasTaColors.forestMuted, marginBottom: 8 },
  selectedCard: { backgroundColor: GasTaColors.glassFillStrong, borderColor: GasTaColors.forestBorder, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, shadowColor: GasTaColors.forest, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6 },
  stationDetails: { gap: 10 },
  stationHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stationName: { color: GasTaColors.forestDark, fontSize: 16, lineHeight: 22, fontWeight: '700' },
  stationAddress: { flexShrink: 1, color: GasTaColors.forestMuted, fontSize: 12, lineHeight: 18 },
  stationFooter: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  provenance: { backgroundColor: GasTaColors.forestGlow, color: GasTaColors.forest, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, fontSize: 10 },
  changeStation: { alignSelf: 'flex-start', paddingVertical: 4 },
  changeStationText: { color: GasTaColors.forest, fontSize: 12, fontWeight: '600' },
  priceSection: { marginVertical: spacing.md },
  priceLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, color: GasTaColors.forestMuted, marginBottom: 8 },
  priceInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: GasTaColors.white, borderWidth: 1, borderColor: GasTaColors.glassBorderSubtle, borderRadius: 16, paddingHorizontal: 16 },
  priceInputFocused: { borderColor: GasTaColors.forest },
  priceInputError: { borderColor: GasTaColors.error },
  priceInput: { flex: 1, minWidth: 0, minHeight: 58, paddingVertical: 12, color: GasTaColors.forestDark, fontSize: 28, fontWeight: '700' },
  priceUnit: { color: GasTaColors.forestMuted, fontSize: 16, fontWeight: '600' },
  fieldError: { color: GasTaColors.error, fontSize: 12, marginTop: 6 },
  notesInput: { minHeight: 74, textAlignVertical: 'top', backgroundColor: GasTaColors.white, borderColor: GasTaColors.glassBorderSubtle, color: GasTaColors.forestDark },
  submitButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, minHeight: 50, borderRadius: 16, backgroundColor: GasTaColors.forest, shadowColor: GasTaColors.forest, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.12, shadowRadius: 6 },
  submitPressed: { backgroundColor: GasTaColors.forestDark },
  submitDisabled: { opacity: 0.5 },
  submitLabel: { color: GasTaColors.white, fontSize: 15, fontWeight: '700' },
  unverifiedBadge: { alignSelf: 'flex-start', color: GasTaColors.forest, backgroundColor: GasTaColors.forestGlow, fontSize: 10, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.pill, marginBottom: 10 },
  // The form keeps a narrower column than the list screens, since inputs and
  // chip rows read worse when they get too wide.
  padding: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    maxWidth: 560,
    alignSelf: 'center',
    width: '100%',
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: GasTaColors.textSoft,
    marginBottom: spacing.sm,
  },
  /* Restrained inline note -- sets the verification expectation without
     implying GasTa or the DOE has approved the figure. */
  expectRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: GasTaColors.forestBorder,
    backgroundColor: GasTaColors.forestGlow,
  },
  expectText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    color: GasTaColors.forestMuted,
  },
  /* Fuel identity for the form's section heads, added around the shared
     FormSection rather than by changing it. */
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: GasTaColors.forestGlow,
  },
  sectionIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GasTaColors.forestGlow,
  },
  sectionHeadCopy: { flex: 1, minWidth: 0 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
    color: GasTaColors.forestDark,
  },
  sectionHint: {
    fontSize: 11,
    lineHeight: 15,
    color: GasTaColors.textSoft,
    marginTop: 1,
  },
  formBlock: { marginTop: 0 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: GasTaColors.error,
    backgroundColor: palette.dangerSoft,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600',
    color: palette.danger,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 68, 33, 0.35)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: GasTaColors.white,
    borderRadius: 20,
    padding: spacing.lg,
    maxWidth: 400,
    width: '100%',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    shadowColor: GasTaColors.forest,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
    elevation: 8,
  },
  successBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: GasTaColors.forestGlow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successTitle: {
    color: GasTaColors.forestDark,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  successBody: {
    color: GasTaColors.forestMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  summary: {
    backgroundColor: GasTaColors.creamLight,
    borderWidth: 1,
    borderColor: GasTaColors.glassBorderSubtle,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryLine: {
    color: GasTaColors.forestDark,
    fontSize: 16,
    fontWeight: '700',
  },
  summaryMeta: {
    color: GasTaColors.forestMuted,
    fontSize: 13,
    marginTop: 4,
  },
  summaryPrice: {
    color: GasTaColors.forestDark,
    fontSize: 20,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  successBtn: {
    marginBottom: spacing.sm,
  },
});
