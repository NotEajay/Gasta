import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

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
import { useTheme } from '@/lib/useTheme';

type SubmittedReport = {
  region: string;
  brand: string;
  station: string;
  fuel: string;
  price: number;
};

export default function ReportPriceScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [stations, setStations] = useState<FuelStationOption[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; slug: string }[]>([]);
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

  const loadStations = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const [list, brands] = await Promise.all([
        fetchFuelStationsByRegion(region),
        fetchOilCompanies(),
      ]);
      setStations(list);
      setCompanies(brands);
      setListedStationId((prev) => (list.some((s) => s.id === prev) ? prev : null));
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    setLoading(true);
    loadStations();
  }, [loadStations]);

  const applyListedStation = (id: string) => {
    const station = stations.find((s) => s.id === id);
    setListedStationId(id);
    if (!station) return;
    setStationName(station.name);
    setCompanyId(station.oil_company.id);
    setStationType(station.brand_label || station.oil_company.name);
  };

  const handleSubmit = async () => {
    if (!user) {
      router.push('/login');
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

    const { data: fuelRow, error: fuelError } = await supabase
      .from('fuel_types')
      .select('id')
      .eq('code', fuelType)
      .single();
    if (fuelError) {
      setFormError(fuelError.message);
      return;
    }

    setSubmitting(true);
    try {
      const knownId =
        companyId ?? (brand ? await findOilCompanyByName(brand) : null);
      const isCatalogBrand = Boolean(knownId);
      const oilCompanyId = knownId ?? (await getIndependentCompanyId());
      const brandLabel = isCatalogBrand ? null : brand;

      const match = stations.find(
        (s) => s.name.trim().toLowerCase() === name.toLowerCase()
      );
      const stationId =
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
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitted(null);
    setFormError(null);
    setStationType('');
    setCompanyId(null);
    setListedStationId(null);
    setStationName('');
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
   * existing rules -- no rule is added, removed, or reordered, and the submit
   * path itself is untouched.
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

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.padding}>
      <SubPageHeader
        module="community"
        title="Report a price"
        subtitle="Help drivers see more recent fuel prices."
      />

      {/* Sets expectations up front so a submission is never read as instantly
          trusted. The full rule is repeated on the success sheet. */}
      <View style={styles.expectRow}>
        <MaterialCommunityIcons
          name="shield-check-outline"
          size={13}
          color={GasTaColors.forestMuted}
        />
        <Text style={styles.expectText}>
          Reports are checked by other drivers, not by GasTa. A report stays Unverified until{' '}
          {VERIFY_CONFIRMATIONS_REQUIRED} people confirm the price.
        </Text>
      </View>

      {/* WHERE */}
      {/*
        Section heads get a small fuel mark and a pale forest rule so the form
        reads as a fuel report rather than a generic form. `FormSection` is
        shared, so the identity is added around it instead of changing it.
      */}
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <MaterialCommunityIcons name="map-marker-outline" size={14} color={GasTaColors.forest} />
        </View>
        <View style={styles.sectionHeadCopy}>
          <Text style={styles.sectionTitle}>Where</Text>
          <Text style={styles.sectionHint}>
            Region, brand, and the station you filled up at.
          </Text>
        </View>
      </View>
      <FormSection
        module="community"
        style={styles.formBlock}>
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
      </FormSection>

      {/* WHAT */}
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <MaterialCommunityIcons name="gas-station" size={14} color={GasTaColors.forest} />
        </View>
        <View style={styles.sectionHeadCopy}>
          <Text style={styles.sectionTitle}>What</Text>
          <Text style={styles.sectionHint}>Fuel grade and the price per liter.</Text>
        </View>
      </View>
      <FormSection module="community" style={styles.formBlock}>
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
          error={priceError}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 62.50"
        />
      </FormSection>

      {/* OPTIONAL */}
      <View style={styles.sectionHead}>
        <View style={styles.sectionIcon}>
          <MaterialCommunityIcons name="note-text-outline" size={14} color={GasTaColors.textSoft} />
        </View>
        <View style={styles.sectionHeadCopy}>
          <Text style={[styles.sectionTitle, styles.sectionTitleMuted]}>Optional</Text>
          <Text style={styles.sectionHint}>Anything that helps others confirm this price.</Text>
        </View>
      </View>
      <FormSection module="community" style={styles.formBlock}>
        <LabeledInput
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          placeholder="Cash price, promo, etc."
        />
      </FormSection>

      {/* Non-field failures (fuel-type lookup, submit errors) still surface as
          a single notice; field-level messages render inline above. */}
      {formError && !brandError && !stationError && !priceError ? (
        <View style={styles.errorBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={14} color={palette.danger} />
          <Text style={styles.errorText}>{formError}</Text>
        </View>
      ) : null}

      <PrimaryButton
        label={submitting ? 'Submitting…' : 'Submit report'}
        onPress={handleSubmit}
        disabled={submitting}
      />

      <Modal
        visible={submitted !== null}
        transparent
        animationType="fade"
        onRequestClose={resetForm}>
        <Pressable style={styles.modalBackdrop} onPress={resetForm}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.successBadge}>
              <Text style={styles.successCheck}>✓</Text>
            </View>
            <Text style={[styles.successTitle, { color: theme.text }]}>
              Submitted for community verification
            </Text>
            <Text style={[styles.successBody, { color: theme.textSecondary }]}>
              GasTa hasn&apos;t verified this yet. It appears as Unverified until{' '}
              {VERIFY_CONFIRMATIONS_REQUIRED} other drivers confirm the price.
            </Text>
            {submitted ? (
              <View style={[styles.summary, { backgroundColor: theme.overlay }]}>
                <Text style={[styles.summaryLine, { color: theme.text }]}>{submitted.station}</Text>
                <Text style={[styles.summaryMeta, { color: theme.textSecondary }]}>
                  {submitted.brand} · {submitted.fuel} · {submitted.region}
                </Text>
                <Text style={[styles.summaryPrice, { color: theme.text }]}>
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
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
    marginBottom: spacing.md,
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
  sectionTitleMuted: { color: GasTaColors.textMuted },
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
    backgroundColor: GasTaColors.forest,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successCheck: {
    color: GasTaColors.textOnForest,
    fontSize: 24,
    fontWeight: '800',
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  successBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  summary: {
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryLine: {
    fontSize: 16,
    fontWeight: '700',
  },
  summaryMeta: {
    fontSize: 13,
    marginTop: 4,
  },
  summaryPrice: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  successBtn: {
    marginBottom: spacing.sm,
  },
});
