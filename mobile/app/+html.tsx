import { ScrollViewStyleReset } from 'expo-router/html';
import type { ReactNode } from 'react';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <ScrollViewStyleReset />

        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* Expo Go OAuth: deep-link back before React hydrates (avoids stuck spinner). */}
        <script dangerouslySetInnerHTML={{ __html: authNativeBridge }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #F8F0E5;
}`;

/**
 * If Supabase redirected to Vercel with ?native=exp://...&code=...,
 * immediately open Expo Go. Runs before the React "Signing you in…" UI.
 */
const authNativeBridge = `
(function () {
  try {
    var params = new URLSearchParams(window.location.search || '');
    var native = params.get('native');
    if (!native) return;

    var dest = new URL(native);
    params.forEach(function (value, key) {
      if (key === 'native') return;
      dest.searchParams.set(key, value);
    });
    if (window.location.hash && window.location.hash.length > 1) {
      dest.hash = window.location.hash;
    }

    document.documentElement.innerHTML =
      '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F8F0E5;color:#014421;font-family:system-ui,sans-serif;font-weight:600;text-align:center;padding:24px">Returning to GasTa…</body>';

    window.location.replace(dest.toString());
  } catch (e) {}
})();
`;
