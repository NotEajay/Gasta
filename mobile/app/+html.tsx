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
        {/* Expo Go OAuth: deep-link back before React hydrates. */}
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
 * If Supabase redirected with ?native=exp://...&code=..., open Expo Go immediately.
 * Do NOT replace documentElement.innerHTML — that aborts the script and dumps JS as text.
 */
const authNativeBridge = `
(function () {
  try {
    var params = new URLSearchParams(window.location.search || "");
    var native = params.get("native");
    if (!native) return;

    var dest = new URL(native);
    params.forEach(function (value, key) {
      if (key === "native") return;
      dest.searchParams.set(key, value);
    });
    if (window.location.hash && window.location.hash.length > 1) {
      dest.hash = window.location.hash;
    }

    window.location.replace(dest.toString());
  } catch (err) {}
})();
`;
