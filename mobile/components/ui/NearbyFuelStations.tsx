import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Text } from '@/components/Themed';
import { GasTaColors, radii, spacing } from '@/constants/Theme';
import {
  fetchNearbyFuelStations,
  type NearbyFuelStation,
} from '@/lib/services/googlePlacesNearby';
import {
  enrichNearbyStations,
  type StationRecommendation,
} from '@/lib/services/stationRecommendation';
import type { DoeRegionCode } from '@/constants/regions';

type Coordinates = { latitude: number; longitude: number };

function unavailableRecommendations(stations: NearbyFuelStation[]): StationRecommendation[] {
  return stations.map((station) => ({
    station,
    priceSource: 'unavailable',
    priceLabel: 'Exact branch price unavailable',
  }));
}

export default function NearbyFuelStations({
  location,
  regionCode,
  fuelTypeId,
  areaName,
}: {
  location: Coordinates | null;
  regionCode: DoeRegionCode | null;
  fuelTypeId: string | null | undefined;
  areaName?: string | null;
}) {
  const [stations, setStations] = useState<NearbyFuelStation[]>([]);
  const [recommendations, setRecommendations] = useState<StationRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!location) {
      setStations([]);
      setRecommendations([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    void fetchNearbyFuelStations(location.latitude, location.longitude)
      .then(async (next) => {
        if (!cancelled) {
          setStations(next);
          setRecommendations(unavailableRecommendations(next));
        }
        let enriched: StationRecommendation[];
        try {
          enriched = await enrichNearbyStations({
            stations: next,
            regionCode,
            fuelTypeId,
            areaName,
          });
        } catch {
          enriched = unavailableRecommendations(next);
        }
        if (!cancelled) {
          setRecommendations(enriched);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [location, regionCode, fuelTypeId, areaName]);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>Nearby fuel stations</Text>
      <Text style={styles.subtitle}>
        DOE estimates reflect area/brand bulletin data and may differ from the actual branch price.
      </Text>
      {!location ? (
        <Text style={styles.message}>Enable location or choose an origin to find nearby stations.</Text>
      ) : loading ? (
        <View style={styles.inline}>
          <ActivityIndicator size="small" color={GasTaColors.forest} />
          <Text style={styles.message}>Finding nearby stations…</Text>
        </View>
      ) : error ? (
        <Text style={styles.message}>Nearby stations are unavailable right now.</Text>
      ) : stations.length === 0 ? (
        <Text style={styles.message}>No gas stations found within 5 km.</Text>
      ) : (
        recommendations.map((recommendation) => (
          <View key={recommendation.station.placeId} style={styles.card}>
            <Text style={styles.name}>{recommendation.station.name}</Text>
            <Text style={styles.address}>{recommendation.station.formattedAddress}</Text>
            <Text style={styles.meta}>
              {recommendation.station.distanceKm.toFixed(1)} km away
              {recommendation.station.openNow === true ? ' · Open now' : recommendation.station.openNow === false ? ' · Closed' : ''}
              {recommendation.station.rating !== undefined ? ` · ${recommendation.station.rating.toFixed(1)}★` : ''}
            </Text>
            {recommendation.pricePerLiter !== undefined ? (
              <>
                <Text style={styles.price}>₱{recommendation.pricePerLiter.toFixed(2)}/L</Text>
                <Text style={styles.priceLabel}>{recommendation.priceLabel}</Text>
              </>
            ) : (
              <Text style={styles.priceLabel}>{recommendation.priceLabel}</Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.lg, gap: spacing.sm },
  title: { color: GasTaColors.forestDark, fontSize: 18, fontWeight: '800' },
  subtitle: { color: GasTaColors.textMuted, fontSize: 12, lineHeight: 17 },
  message: { color: GasTaColors.textMuted, fontSize: 13, lineHeight: 19 },
  inline: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
  card: {
    backgroundColor: GasTaColors.creamLight,
    borderColor: GasTaColors.glassBorderSubtle,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: 3,
  },
  name: { color: GasTaColors.forestDark, fontSize: 15, fontWeight: '800' },
  address: { color: GasTaColors.textMuted, fontSize: 12, lineHeight: 17 },
  meta: { color: GasTaColors.forest, fontSize: 12, fontWeight: '700' },
  price: { color: GasTaColors.forestDark, fontSize: 16, fontWeight: '800', marginTop: 4 },
  priceLabel: { color: GasTaColors.textMuted, fontSize: 12, fontWeight: '700' },
});
