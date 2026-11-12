import { ScrollViewStyleReset, useServerDocumentContext } from 'expo-router/html';
import type { ReactNode } from 'react';

// This file is web-only and used to configure the root HTML for every
// web page during static rendering.
export default function Root({ children }: { children: ReactNode }) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } = useServerDocumentContext();

  return (
    <html lang="en" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />

        <ScrollViewStyleReset />
        {headNodes}

        <style dangerouslySetInnerHTML={{ __html: responsiveBackground }} />
        {/* A tab left open across deployments can request a deleted hashed bundle. */}
        <script dangerouslySetInnerHTML={{ __html: staleBundleRecovery }} />
        {/* Expo Go OAuth: deep-link back before React hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: authNativeBridge }} />
      </head>
      <body {...bodyAttributes}>{children}{bodyNodes}</body>
    </html>
  );
}

const responsiveBackground = `
body {
  background-color: #F5F6F7;
}`;

export const staleBundleRecovery = `
(function () {
  var retryKey = ${JSON.stringify('gasta:stale-bundle-retry')};

  function messageFrom(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    return String(value.message || value.reason || value.error || value);
  }

  function isStaleBundleMessage(message) {
    var lower = String(message || "").toLowerCase();
    var isExpoBundle = lower.indexOf("/_expo/static/js/web/") !== -1 && lower.indexOf(".js") !== -1;
    var isLoadFailure = lower.indexOf("loading module") !== -1
      || lower.indexOf("failed to fetch dynamically imported module") !== -1
      || lower.indexOf("chunkloaderror") !== -1
      || lower.indexOf("importing a module script failed") !== -1;
    return isExpoBundle && isLoadFailure;
  }

  function recover(message) {
    if (!isStaleBundleMessage(message)) return false;
    try {
      var lastRetry = Number(window.sessionStorage.getItem(retryKey) || "0");
      if (Date.now() - lastRetry < 60000) return false;
      window.sessionStorage.setItem(retryKey, String(Date.now()));
      var url = new URL(window.location.href);
      url.searchParams.set("__bundle_retry", String(Date.now()));
      window.location.replace(url.toString());
      return true;
    } catch (error) {
      return false;
    }
  }

  window.addEventListener("error", function (event) {
    var target = event.target;
    var source = target && target.src ? String(target.src) : "";
    recover(messageFrom(event.error || event.message) + " " + source);
  }, true);

  window.addEventListener("unhandledrejection", function (event) {
    recover(messageFrom(event.reason));
  });

  var params = new URLSearchParams(window.location.search || "");
  if (!params.has("__bundle_retry")) {
    try { window.sessionStorage.removeItem(retryKey); } catch (error) {}
  }
})();
`;

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
