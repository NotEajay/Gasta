import type { GenerateMetadataFunction } from 'expo-router/server';
import { Redirect } from 'expo-router';
import Head from 'expo-router/head';
import { useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import BrandWordmark from '@/components/ui/BrandWordmark';
import LandingFeatureCard, {
  type LandingFeature,
} from '@/components/landing/LandingFeatureCard';
import LandingHeroVideo from '@/components/landing/LandingHeroVideo';
import LandingLink from '@/components/landing/LandingLink';
import { GasTaColors, colors, radii, spacing } from '@/constants/Theme';

const SIGN_IN_URL = '/login?mode=signin';
const SIGN_UP_URL = '/login?mode=signup';
const META_TITLE = 'GasTa | Practical fuel and trip planning';
const META_DESCRIPTION =
  'Use weekly DOE fuel-price context, verified community reports, last-refill trip comparisons, and personal vehicle, refill, and budget tracking.';
const META_SOCIAL_DESCRIPTION =
  'Weekly fuel-price context, trip comparisons based on your last refill, and personal fuel tracking in one place.';
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || 'https://gasta-kappa.vercel.app').replace(/\/$/, '');
const POSTER_URL = `${SITE_URL}/landing/gasta-landing-poster.jpg`;

const FEATURES: LandingFeature[] = [
  {
    icon: 'pricetags-outline',
    eyebrow: 'Fuel context',
    title: 'See the week in context',
    body: 'Review weekly DOE price bulletins alongside fresh, verified community reports, with the source kept clear.',
  },
  {
    icon: 'git-compare-outline',
    eyebrow: 'Trip comparison',
    title: 'Compare before you go',
    body: "Enter your trip distance and compare travel options using your selected vehicle's last-refill price.",
  },
  {
    icon: 'speedometer-outline',
    eyebrow: 'Personal tracking',
    title: 'Keep the essentials together',
    body: 'Organize vehicle details, refill records, and fuel budgets in one practical place.',
  },
];

export const generateMetadata: GenerateMetadataFunction = () => ({
  title: META_TITLE,
  description: META_DESCRIPTION,
  applicationName: 'GasTa',
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: META_TITLE,
    description: META_SOCIAL_DESCRIPTION,
    images: [{ url: POSTER_URL, width: 1280, height: 720, alt: 'GasTa fuel and trip planning' }],
    locale: 'en_PH',
    siteName: 'GasTa',
    type: 'website',
    url: SITE_URL,
  },
  twitter: {
    card: 'summary_large_image',
    title: META_TITLE,
    description: META_SOCIAL_DESCRIPTION,
    images: [{ url: POSTER_URL, alt: 'GasTa fuel and trip planning' }],
  },
});

function subscribeToViewport(onStoreChange: () => void) {
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

function getBrowserWidth() {
  return window.innerWidth;
}

function getServerWidth() {
  return 390;
}

export default function LandingPage() {
  const width = useSyncExternalStore(subscribeToViewport, getBrowserWidth, getServerWidth);
  if (typeof window !== 'undefined') {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      return <Redirect href={`/auth/callback?code=${encodeURIComponent(code)}`} />;
    }
  }

  const isDesktop = width >= 1024;
  const isCompact = width < 360;
  const shellStyle: ViewStyle = isDesktop
    ? {}
    : { maxWidth: Math.min(Math.max(width * 0.92, 320), width >= 768 ? 720 : 400) };
  const horizontalPadding = isDesktop ? '5%' : Math.min(Math.max(width * 0.06, 16), 32);

  return (
    <>
      <LandingMetadata />
      <ScrollView style={styles.viewport} contentContainerStyle={styles.page} testID="landing-page">
        <View style={styles.topWash} />
        <View style={styles.headerOuter} role="banner">
        <View style={[styles.header, shellStyle, { paddingHorizontal: horizontalPadding }]}>
          <BrandWordmark width={isDesktop ? 144 : isCompact ? 94 : 112} />
          <View style={styles.headerActions}>
            <LandingLink href={SIGN_IN_URL} style={styles.headerQuietLink} variant="quiet">
              Sign in
            </LandingLink>
            <LandingLink href={SIGN_UP_URL} style={styles.headerPrimaryLink}>
              Create account
            </LandingLink>
          </View>
        </View>
      </View>

      <View style={styles.main} role="main">
        <View
          style={[
            styles.sectionOuter,
            styles.heroOuter,
          ]}>
          <View
            style={[
              styles.hero,
              shellStyle,
              { paddingHorizontal: horizontalPadding },
              isDesktop ? styles.heroDesktop : styles.heroStacked,
            ]}
            testID={isDesktop ? 'landing-hero-desktop' : 'landing-hero-stacked'}>
            <View
              style={[styles.heroCopy, isDesktop && styles.heroCopyDesktop]}
              testID="landing-hero-copy">
              <View style={styles.kicker}>
                <View style={styles.kickerDot} />
                <Text style={styles.kickerText}>Built for everyday fuel decisions</Text>
              </View>
              <Text
                accessibilityRole="header"
                aria-level={1}
                style={[
                  styles.heroTitle,
                  isDesktop && styles.heroTitleDesktop,
                  isCompact && styles.heroTitleCompact,
                ]}>
                Make every fuel decision with clearer context.
              </Text>
              <Text style={[styles.heroBody, isDesktop && styles.heroBodyDesktop]}>
                GasTa brings weekly DOE fuel-price context, verified community reports,
                trip comparisons based on your vehicle&apos;s last-refill price, and personal
                fuel tracking into one practical dashboard.
              </Text>
              <View style={[styles.heroActions, isCompact && styles.heroActionsCompact]}>
                <LandingLink href={SIGN_UP_URL} style={isCompact ? styles.fullWidthLink : undefined}>
                  Create your account
                </LandingLink>
                <LandingLink
                  href={SIGN_IN_URL}
                  style={isCompact ? styles.fullWidthLink : undefined}
                  variant="secondary">
                  Sign in
                </LandingLink>
              </View>
              <View style={styles.heroNote}>
                <View style={styles.heroNoteMark}>
                  <Text style={styles.heroNoteMarkText}>₱</Text>
                </View>
                <Text style={styles.heroNoteText}>
                  Trip estimates use the fuel price you actually paid at your last refill.
                </Text>
              </View>
            </View>

            <View
              style={[styles.heroMedia, isDesktop && styles.heroMediaDesktop]}
              testID="landing-hero-media">
              <View style={styles.mediaAccentTop} />
              <View style={styles.mediaAccentBottom} />
              <LandingHeroVideo />
            </View>
          </View>
        </View>

        <View
          style={[styles.sectionOuter, styles.featuresOuter]}
          testID="landing-features">
          <View style={[styles.section, shellStyle, { paddingHorizontal: horizontalPadding }]}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionEyebrow}>What GasTa helps you do</Text>
              <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>
                Useful context without the guesswork
              </Text>
              <Text style={styles.sectionBody}>
                Plan with published and verified inputs, then keep your own fuel picture up to date.
              </Text>
            </View>
            <View style={[styles.featureGrid, !isDesktop && styles.featureGridStacked]}>
              {FEATURES.map((feature) => (
                <LandingFeatureCard feature={feature} key={feature.title} />
              ))}
            </View>
          </View>
        </View>

        <View
          style={[styles.sectionOuter, styles.closingOuter, { paddingHorizontal: horizontalPadding }]}>
          <View
            style={[
              styles.closing,
              shellStyle,
              isDesktop && styles.closingDesktop,
            ]}
            testID="landing-closing-cta">
            <View style={styles.closingCopy}>
              <Text style={styles.closingEyebrow}>Your next drive starts here</Text>
              <Text accessibilityRole="header" aria-level={2} style={styles.closingTitle}>
                Put your own fuel picture in focus.
              </Text>
              <Text style={styles.closingBody}>
                Add a vehicle, record refills, compare a trip, and shape a budget that reflects you.
              </Text>
            </View>
            <View style={[styles.closingActions, !isDesktop && styles.closingActionsStacked]}>
              <LandingLink href={SIGN_UP_URL} style={!isDesktop ? styles.fullWidthLink : undefined}>
                Get started
              </LandingLink>
              <LandingLink
                href={SIGN_IN_URL}
                style={!isDesktop ? styles.fullWidthLink : undefined}
                variant="secondary">
                I already have an account
              </LandingLink>
            </View>
          </View>
        </View>
      </View>

        <View
          style={styles.footerOuter}
          role="contentinfo">
          <View style={[styles.footer, shellStyle, { paddingHorizontal: horizontalPadding }]}>
            <Text style={styles.footerBrand}>GasTa</Text>
            <Text style={styles.footerText}>
              Weekly fuel context and personal planning for drivers in the Philippines.
            </Text>
            <LandingLink href={SIGN_IN_URL} style={styles.footerLink} variant="quiet">
              Sign in
            </LandingLink>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

function LandingMetadata() {
  return (
    <Head>
      <title>{META_TITLE}</title>
      <meta content={META_DESCRIPTION} name="description" />
      <link href={SITE_URL} rel="canonical" />
      <meta content={META_TITLE} property="og:title" />
      <meta content={META_SOCIAL_DESCRIPTION} property="og:description" />
      <meta content="website" property="og:type" />
      <meta content="en_PH" property="og:locale" />
      <meta content="GasTa" property="og:site_name" />
      <meta content={SITE_URL} property="og:url" />
      <meta content={POSTER_URL} property="og:image" />
      <meta content="1280" property="og:image:width" />
      <meta content="720" property="og:image:height" />
      <meta content="GasTa fuel and trip planning" property="og:image:alt" />
      <meta content="summary_large_image" name="twitter:card" />
      <meta content={META_TITLE} name="twitter:title" />
      <meta content={META_SOCIAL_DESCRIPTION} name="twitter:description" />
      <meta content={POSTER_URL} name="twitter:image" />
      <meta content="GasTa fuel and trip planning" name="twitter:image:alt" />
    </Head>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  page: {
    alignItems: 'center',
    backgroundColor: GasTaColors.cream,
    flexGrow: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  topWash: {
    backgroundColor: colors.primarySoft,
    borderBottomLeftRadius: 999,
    borderBottomRightRadius: 999,
    height: 560,
    left: '-18%',
    opacity: 0.72,
    position: 'absolute',
    right: '-18%',
    top: -280,
  },
  headerOuter: {
    alignItems: 'center',
    width: '100%',
    zIndex: 2,
  },
  header: {
    alignItems: 'center',
    boxSizing: 'border-box',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 84,
    paddingVertical: 14,
    width: '100%',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  headerQuietLink: {
    minHeight: 44,
    paddingHorizontal: 10,
  },
  headerPrimaryLink: {
    minHeight: 44,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  main: {
    width: '100%',
    zIndex: 1,
  },
  sectionOuter: {
    alignItems: 'center',
    width: '100%',
  },
  section: {
    boxSizing: 'border-box',
    width: '100%',
  },
  heroOuter: {
    paddingBottom: 88,
    paddingTop: 62,
  },
  hero: {
    alignItems: 'center',
    boxSizing: 'border-box',
    width: '100%',
  },
  heroDesktop: {
    flexDirection: 'row',
    gap: 54,
  },
  heroStacked: {
    gap: 48,
  },
  heroCopy: {
    width: '100%',
  },
  heroCopyDesktop: {
    flex: 0.92,
    minWidth: 0,
  },
  kicker: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderColor: colors.primaryBorder,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: spacing.lg,
    minHeight: 34,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  kickerDot: {
    backgroundColor: colors.accent,
    borderColor: colors.navy,
    borderRadius: 99,
    borderWidth: 1,
    height: 9,
    width: 9,
  },
  kickerText: {
    color: colors.navy,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: colors.navy,
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: -1.4,
    lineHeight: 48,
    maxWidth: 700,
  },
  heroTitleDesktop: {
    fontSize: 52,
    letterSpacing: -2,
    lineHeight: 58,
  },
  heroTitleCompact: {
    fontSize: 35,
    letterSpacing: -1.1,
    lineHeight: 41,
  },
  heroBody: {
    color: GasTaColors.textMuted,
    fontSize: 17,
    lineHeight: 27,
    marginTop: spacing.lg,
    maxWidth: 700,
  },
  heroBodyDesktop: {
    maxWidth: 530,
  },
  heroActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 30,
  },
  heroActionsCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  fullWidthLink: {
    width: '100%',
  },
  heroNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    marginTop: spacing.lg,
    maxWidth: 500,
  },
  heroNoteMark: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 99,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  heroNoteMarkText: {
    color: colors.navy,
    fontSize: 14,
    fontWeight: '900',
  },
  heroNoteText: {
    color: GasTaColors.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  heroMedia: {
    position: 'relative',
    width: '100%',
  },
  heroMediaDesktop: {
    flex: 1.18,
    maxWidth: 640,
    minWidth: 0,
  },
  mediaAccentTop: {
    backgroundColor: colors.primary,
    borderRadius: 18,
    height: 76,
    position: 'absolute',
    right: -14,
    top: -14,
    width: 76,
  },
  mediaAccentBottom: {
    backgroundColor: colors.accent,
    borderRadius: 18,
    bottom: -14,
    height: 76,
    left: -14,
    position: 'absolute',
    width: 76,
  },
  featuresOuter: {
    backgroundColor: '#FFFFFF',
    paddingBottom: 100,
    paddingTop: 92,
  },
  sectionHeading: {
    alignSelf: 'center',
    alignItems: 'center',
    maxWidth: 670,
  },
  sectionEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.9,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: colors.navy,
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.9,
    lineHeight: 42,
    marginTop: 10,
    textAlign: 'center',
  },
  sectionBody: {
    color: GasTaColors.textMuted,
    fontSize: 16,
    lineHeight: 25,
    marginTop: 12,
    textAlign: 'center',
  },
  featureGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: 46,
  },
  featureGridStacked: {
    flexDirection: 'column',
  },
  closingOuter: {
    backgroundColor: '#FFFFFF',
    boxSizing: 'border-box',
    paddingBottom: 88,
  },
  closing: {
    backgroundColor: colors.navy,
    borderRadius: radii.xl,
    overflow: 'hidden',
    padding: 34,
    position: 'relative',
    width: '100%',
  },
  closingDesktop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 48,
    paddingVertical: 42,
  },
  closingCopy: {
    maxWidth: 610,
  },
  closingEyebrow: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  closingTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 38,
    marginTop: 8,
  },
  closingBody: {
    color: '#DCE4EC',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
    maxWidth: 550,
  },
  closingActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginLeft: spacing.lg,
  },
  closingActionsStacked: {
    alignItems: 'stretch',
    flexDirection: 'column',
    marginLeft: 0,
    marginTop: spacing.lg,
  },
  footerOuter: {
    alignItems: 'center',
    backgroundColor: GasTaColors.cream,
    width: '100%',
  },
  footer: {
    alignItems: 'center',
    boxSizing: 'border-box',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    minHeight: 104,
    paddingVertical: spacing.lg,
    width: '100%',
  },
  footerBrand: {
    color: colors.navy,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  footerText: {
    color: GasTaColors.textMuted,
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    minWidth: 220,
  },
  footerLink: {
    minHeight: 44,
  },
});
