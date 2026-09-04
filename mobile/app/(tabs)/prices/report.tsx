import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import AuthPrompt from '@/components/AuthPrompt';
import SupabaseSetupBanner from '@/components/SupabaseSetupBanner';
import Card from '@/components/ui/Card';
import ChipSelect from '@/components/ui/ChipSelect';
import SubPageHeader from '@/components/ui/SubPageHeader';
import FormSection from '@/components/ui/FormSection';
import LabeledInput from '@/components/ui/LabeledInput';
import LoadingState from '@/components/ui/LoadingState';
import PrimaryButton from '@/components/ui/PrimaryButton';
import { DOE_FUEL_TYPES, type DoeFuelTypeCode } from '@/constants/fuelTypes';
import { DOE_REGIONS, REGION_CENTROIDS, type DoeRegionCode } from '@/constants/regions';
import { GasTaColors, palette, spacing } from '@/constants/Theme';
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
  const [listedStationId, setListedStationId] = useState<string | null>(null);
  const [stationName, setStationName] = useState('');
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

  return (
    <ScrollView
      style={[styles.flex, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.padding}>
      <SubPageHeader
        module="community"
        title="Report a Price"
        subtitle="Type the station and what you paid. 3 confirmations makes it verified."
      />

      <FormSection
        title="Station"
        subtitle="Type the brand and station name. New stations stay in this region only."
        module="community">
        <ChipSelect
          label="Region"
          options={DOE_REGIONS.map((r) => ({ value: r.code, label: r.name }))}
          value={region}
          onChange={setRegion}
          module="community"
        />
        <LabeledInput
          label="Station type"
          value={stationType}
          onChangeText={(text) => {
            setStationType(text);
            const match = companies.find((c) => c.name.toLowerCase() === text.trim().toLowerCase());
            setCompanyId(match?.id ?? null);
            setListedStationId(null);
          }}
          placeholder="e.g. Petron, Shell, independent"
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
          label="Station name"
          value={stationName}
          onChangeText={(text) => {
            setStationName(text);
            setListedStationId(null);
          }}
          placeholder="e.g. Petron EDSA Shaw"
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
          <Text style={[styles.hint, { color: theme.textSecondary }]}>
            New stations are saved only for this region. They will not appear in other regions.
          </Text>
        )}
      </FormSection>

      <FormSection title="Price" module="community">
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
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 62.50"
        />
        <LabeledInput
          label="Notes (optional)"
          value={notes}
          onChangeText={setNotes}
          placeholder="Cash price, promo, etc."
        />
      </FormSection>

      {formError ? (
        <Card style={{ borderColor: palette.danger, backgroundColor: palette.dangerSoft }}>
          <Text style={{ color: palette.danger, fontWeight: '600' }}>{formError}</Text>
        </Card>
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
            <Text style={[styles.successTitle, { color: theme.text }]}>Report submitted</Text>
            <Text style={[styles.successBody, { color: theme.textSecondary }]}>
              It is listed under Community prices as Unverified until 3 more people confirm it.
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
              onPress={() => router.replace('/(tabs)/prices')}
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
  hint: { fontSize: 13, lineHeight: 18, marginBottom: spacing.sm },
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
