# GasTa! Mobile

TypeScript mobile app for **GasTa!** — a transportation cost decision support system for fuel price monitoring and trip optimization.

## Stack

- **TypeScript** — static typing for fuel records, vehicle profiles, and trip calculations
- **React Native + Expo** — cross-platform mobile development
- **Expo Router** — file-based navigation
- **Supabase** — authentication and database (configure via `.env`)

## Prerequisites

- Node.js 18+ (tested with v22)
- [Expo Go](https://expo.dev/go) on your Android/iOS device for live preview

## Setup

```powershell
cd mobile
copy .env.example .env
# Fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
```

## Development

```powershell
npm start          # Expo dev server (scan QR with Expo Go)
npm run android    # Open on Android emulator/device
npm run web        # Run in browser
```

## Project layout

```
app/           Expo Router screens and navigation
components/    Reusable UI components
constants/     Theme and shared constants
lib/           Supabase client and shared utilities
types/         Domain TypeScript types
```
