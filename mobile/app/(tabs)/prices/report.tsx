import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import SubPageHeader from '@/components/ui/SubPageHeader';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, REGION_CENTROIDS, type DoeRegionCode } from '@/constants/regions';
import { GasTaColors, palette, radii, spacing, typography } from '@/constants/Theme';
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
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';

type SubmittedReport = {
  region: string;
  brand: string;
  station: string;
  fuel: string;
  price: number;
};

type FieldErrors = {
  station?: string;
  fuel?: string;
  price?: string;
  general?: string;
};

function FieldLabel({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[styles.fieldLabel, { color: theme.textSecondary }]}>{children}</Text>;
}

export default function ReportPriceScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, loading: authLoading } = useAuth();
  const [region, setRegion] = useState<DoeRegionCode>('NCR');
  const [fuelType, setFuelType] = useState<DoeFuelTypeCode>('RON_91');
  const [stations, setStations] = useState<FuelStationOption[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [listedStationId, setListedStationId] = useState<string | null>(null);
  const [stationSearch, setStationSearch] = useState('');
  const [stationName, setStationName] = useState('');
  const [stationType, setStationType] = useState('');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [showManualStation, setShowManualStation] = useState(false);
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState<SubmittedReport | null>(null);

  const loadStations = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [list, brands] = await Promise.all([
        fetchFuelStationsByRegion(region),
        fetchOilCompanies(),
      ]);
      setStations(list);
      setCompanies(brands);
      setListedStationId((previous) => (list.some((station) => station.id === previous) ? previous : null));
    } catch (error) {
      setFormError({ general: error instanceof Error ? error.message : 'Unable to load stations.' });
    } finally {
      setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  const filteredStations = useMemo(() => {
    const query = stationSearch.trim().toLowerCase();
    if (!query) return stations.slice(0, 8);
    return stations
      .filter((station) =>
        `${station.name} ${station.address ?? ''} ${station.brand_label ?? station.oil_company.name}`
          .toLowerCase()
          .includes(query)
      )
      .slice(0, 8);
  }, [stationSearch, stations]);

  const applyListedStation = (id: string) => {
    const station = stations.find((item) => item.id === id);
    if (!station) return;
    setListedStationId(id);
    setStationName(station.name);
    setStationType(station.brand_label || station.oil_company.name);
    setCompanyId(station.oil_company.id);
    setStationSearch('');
    setFormError((previous) => ({ ...previous, station: undefined, general: undefined }));
  };

  const handleBrandChange = (value: string) => {
    setStationType(value);
    const match = companies.find((company) => company.name.toLowerCase() === value.trim().toLowerCase());
    setCompanyId(match?.id ?? null);
    setListedStationId(null);
  };

  const handleSubmit = async () => {
    if (!user) {
      router.push('/login');
      return;
    }

    const name = stationName.trim();
    const brand = stationType.trim();
    const priceNum = Number.parseFloat(price);
    const errors: FieldErrors = {};

    if (!name) errors.station = 'Select a listed station or enter the station name.';
    if (!fuelType) errors.fuel = 'Choose the fuel type you observed.';
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      errors.price = 'Enter a valid price per liter.';
    }
    if (!brand && !companyId) {
      errors.station = 'Select a station with a brand, or enter the station brand.';
    }
    setFormError(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const { data: fuelRow, error: fuelError } = await supabase
        .from('fuel_types')
        .select('id')
        .eq('code', fuelType)
        .single();
      if (fuelError) throw fuelError;

      const knownId = companyId ?? (await findOilCompanyByName(brand));
      const oilCompanyId = knownId ?? (await getIndependentCompanyId());
      const match = stations.find((station) => station.name.trim().toLowerCase() === name.toLowerCase());
      const stationId =
        match?.id ??
        (await createFuelStation({
          name,
          oilCompanyId,
          regionCode: region,
          latitude: REGION_CENTROIDS[region].latitude,
          longitude: REGION_CENTROIDS[region].longitude,
          brandLabel: knownId ? null : brand,
        }));

      await submitCommunityReport({
        stationId,
        fuelTypeId: fuelRow.id,
        price: priceNum,
        notes: notes.trim() || undefined,
      });

      setSubmitted({
        region: DOE_REGIONS.find((item) => item.code === region)?.name ?? region,
        brand: brand || 'Independent',
        station: name,
        fuel: DOE_FUEL_TYPES.find((item) => item.code === fuelType)?.name ?? fuelType,
        price: priceNum,
      });
      setFormError({});
    } catch (error) {
      setFormError({
        general: error instanceof Error ? error.message : 'Unable to submit the report. Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setSubmitted(null);
    setFormError({});
    setListedStationId(null);
    setStationSearch('');
    setStationName('');
    setStationType('');
    setCompanyId(null);
    setShowManualStation(false);
    setPrice('');
    setNotes('');
  };

  if (!isSupabaseConfigured) {
    return <SupabaseSetupBanner />;
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

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}
      keyboardShouldPersistTaps="handled">
      <SubPageHeader
        module="community"
        title="Report Fuel Price"
        subtitle="Help keep fuel prices accurate in your area."
      />

      <Card style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Select a station</Text>
        <Text style={[styles.sectionHint, { color: theme.textSecondary }]}>
          Search for the station where you saw the price.
        </Text>

        <ChipSelect
          label="Region"
          options={DOE_REGIONS.map((item) => ({ value: item.code, label: item.name }))}
          value={region}
          onChange={(value) => {
            setRegion(value);
            setListedStationId(null);
            setStationSearch('');
            setStationName('');
            setStationType('');
            setCompanyId(null);
          }}
          module="community"
        />

        {!showManualStation ? (
          <TextInput
            value={stationSearch}
            onChangeText={setStationSearch}
            placeholder="Search station name or address"
            placeholderTextColor={theme.textMuted}
            style={[styles.searchInput, { color: theme.text, borderColor: theme.border }]}
            autoCapitalize="words"
          />
        ) : null}

        {!showManualStation && !listedStationId && filteredStations.length > 0 ? (
          <View style={styles.stationList}>
            {filteredStations.map((station) => {
              const selected = station.id === listedStationId;
              return (
                <Pressable
                  key={station.id}
                  onPress={() => applyListedStation(station.id)}
                  style={({ pressed }) => [
                    styles.stationRow,
                    {
                      backgroundColor: selected ? palette.primarySoft : theme.surface,
                      borderColor: selected ? palette.primary : theme.border,
                      opacity: pressed ? 0.82 : 1,
                    },
                  ]}>
                  <View style={styles.stationCopy}>
                    <Text style={[styles.stationName, { color: theme.text }]}>{station.name}</Text>
                    <Text style={[styles.stationMeta, { color: theme.textSecondary }]}>
                      {station.brand_label || station.oil_company.name}
                      {station.address ? ` · ${station.address}` : ''}
                    </Text>
                  </View>
                  <Text style={[styles.stationCheck, { color: palette.primary }]}>
                    {selected ? '✓' : '›'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {listedStationId ? (
          <View style={[styles.selectedStation, { backgroundColor: palette.primarySoft }]}>
            <Text style={[styles.selectedLabel, { color: palette.primary }]}>Selected station</Text>
            <Text style={[styles.selectedName, { color: theme.text }]}>{stationName}</Text>
            <Text style={[styles.selectedMeta, { color: theme.textSecondary }]}>{stationType}</Text>
            <Pressable
              onPress={() => {
                setListedStationId(null);
                setStationName('');
                setStationType('');
                setCompanyId(null);
                setStationSearch('');
              }}>
              <Text style={[styles.changeText, { color: palette.primary }]}>Change station</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => {
              setShowManualStation((value) => !value);
              setFormError((previous) => ({ ...previous, station: undefined }));
            }}
            style={styles.manualToggle}>
            <Text style={[styles.manualToggleText, { color: palette.primary }]}>
              {showManualStation ? '← Search listed stations' : 'Station not listed? Add it manually'}
            </Text>
          </Pressable>
        )}

        {showManualStation ? (
          <View style={styles.manualFields}>
            <FieldLabel>Station name</FieldLabel>
            <TextInput
              value={stationName}
              onChangeText={(value) => {
                setStationName(value);
                setListedStationId(null);
              }}
              placeholder="e.g. Petron Naga City"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: formError.station ? palette.danger : theme.border }]}
              autoCapitalize="words"
            />
            <FieldLabel>Station brand</FieldLabel>
            <TextInput
              value={stationType}
              onChangeText={handleBrandChange}
              placeholder="e.g. Petron, Shell, or PTT"
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              autoCapitalize="words"
            />
            {companies.length > 0 ? (
              <ChipSelect
                label="Known brands"
                options={companies.map((company) => ({ value: company.id, label: company.name }))}
                value={companyId}
                onChange={(id) => {
                  setCompanyId(id);
                  setStationType(companies.find((company) => company.id === id)?.name ?? '');
                }}
                module="community"
              />
            ) : null}
          </View>
        ) : null}
        {formError.station ? <Text style={styles.errorText}>{formError.station}</Text> : null}
      </Card>

      <Card style={styles.sectionCard}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Select fuel type</Text>
        <ChipSelect
          label="Fuel type"
          options={DOE_FUEL_TYPES.map((item) => ({ value: item.code, label: item.name }))}
          value={fuelType}
          onChange={(value) => {
            setFuelType(value);
            setFormError((previous) => ({ ...previous, fuel: undefined }));
          }}
          module="community"
        />
        {formError.fuel ? <Text style={styles.errorText}>{formError.fuel}</Text> : null}
      </Card>

      <Card style={styles.priceCard}>
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Enter pump price</Text>
        <Text style={[styles.sectionHint, { color: theme.textSecondary }]}>
          Use the price you saw at the station today.
        </Text>
        <View style={[styles.priceInputWrap, { borderColor: formError.price ? palette.danger : palette.primary }]}>
          <Text style={[styles.currency, { color: palette.primary }]}>₱</Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            placeholderTextColor={theme.textMuted}
            keyboardType="decimal-pad"
            style={[styles.priceInput, { color: theme.text }]}
          />
          <Text style={[styles.perLiter, { color: theme.textSecondary }]}>per liter</Text>
        </View>
        {formError.price ? <Text style={styles.errorText}>{formError.price}</Text> : null}
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Notes (optional): cash price, promo, etc."
          placeholderTextColor={theme.textMuted}
          style={[styles.input, styles.notesInput, { color: theme.text, borderColor: theme.border }]}
        />
      </Card>

      {formError.general ? (
        <Card style={[styles.errorCard, { borderColor: palette.danger }]}>
          <Text style={styles.errorText}>{formError.general}</Text>
        </Card>
      ) : null}

      <PrimaryButton
        label={submitting ? 'Submitting report…' : 'Submit Price'}
        onPress={handleSubmit}
        disabled={submitting}
      />
      <Text style={[styles.disclaimer, { color: theme.textSecondary }]}>
        Community reports supplement official DOE prices and are reviewed by other users.
      </Text>

      <Modal visible={submitted !== null} transparent animationType="fade" onRequestClose={resetForm}>
        <Pressable style={styles.modalBackdrop} onPress={resetForm}>
          <Pressable style={styles.modalCard} onPress={(event) => event.stopPropagation()}>
            <View style={styles.successBadge}>
              <Text style={styles.successCheck}>✓</Text>
            </View>
            <Text style={[styles.successTitle, { color: theme.text }]}>Price Report Submitted</Text>
            <Text style={[styles.successBody, { color: theme.textSecondary }]}>
              Your report is awaiting community verification. It is not an official DOE price.
            </Text>
            {submitted ? (
              <View style={[styles.summary, { backgroundColor: theme.overlay }]}>
                <Text style={[styles.summaryPrice, { color: theme.text }]}>
                  {formatCurrency(submitted.price)}/L
                </Text>
                <Text style={[styles.summaryLine, { color: theme.text }]}>{submitted.station}</Text>
                <Text style={[styles.summaryMeta, { color: theme.textSecondary }]}>
                  {submitted.brand} · {submitted.fuel} · {submitted.region}
                </Text>
                <Text style={[styles.awaiting, { color: palette.warning }]}>Awaiting verification · 1 / 3</Text>
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
  padding: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionCard: { padding: spacing.md, marginBottom: spacing.md },
  priceCard: { padding: spacing.md, marginBottom: spacing.md },
  sectionTitle: { fontSize: 19, fontWeight: '800', marginBottom: spacing.xs },
  sectionHint: { fontSize: 13, lineHeight: 18, marginBottom: spacing.md },
  searchInput: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  stationList: { gap: spacing.sm },
  stationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  stationCopy: { flex: 1, paddingRight: spacing.sm },
  stationName: { fontSize: 14, fontWeight: '800' },
  stationMeta: { fontSize: 12, lineHeight: 17, marginTop: 3 },
  stationCheck: { fontSize: 22, fontWeight: '800' },
  selectedStation: { borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm },
  selectedLabel: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 },
  selectedName: { fontSize: 16, fontWeight: '800', marginTop: spacing.xs },
  selectedMeta: { fontSize: 13, marginTop: 2 },
  changeText: { fontSize: 13, fontWeight: '800', marginTop: spacing.sm },
  manualToggle: { paddingVertical: spacing.sm, alignItems: 'center' },
  manualToggleText: { fontSize: 13, fontWeight: '800' },
  manualFields: { marginTop: spacing.md },
  fieldLabel: { ...typography.label, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    fontSize: 15,
    marginBottom: spacing.md,
  },
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: GasTaColors.creamLight,
  },
  currency: { fontSize: 30, fontWeight: '800' },
  priceInput: { flex: 1, fontSize: 30, fontWeight: '800', paddingVertical: spacing.sm },
  perLiter: { fontSize: 12, fontWeight: '700' },
  notesInput: { marginTop: spacing.md, marginBottom: 0 },
  errorCard: { padding: spacing.md, marginBottom: spacing.md, backgroundColor: palette.dangerSoft },
  errorText: { color: palette.danger, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  disclaimer: { textAlign: 'center', fontSize: 12, lineHeight: 17, marginTop: spacing.sm },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(1, 68, 33, 0.35)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    backgroundColor: GasTaColors.white,
    borderRadius: radii.lg,
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
  successCheck: { color: GasTaColors.textOnForest, fontSize: 24, fontWeight: '800' },
  successTitle: { fontSize: 20, fontWeight: '800', marginBottom: spacing.xs },
  successBody: { fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  summary: { borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md },
  summaryPrice: { fontSize: 24, fontWeight: '800', marginBottom: spacing.xs },
  summaryLine: { fontSize: 16, fontWeight: '700' },
  summaryMeta: { fontSize: 13, marginTop: 4 },
  awaiting: { fontSize: 12, fontWeight: '700', marginTop: spacing.sm },
  successBtn: { marginBottom: spacing.sm },
});
