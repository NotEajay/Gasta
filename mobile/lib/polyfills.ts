import { Platform } from 'react-native';
import * as ExpoCrypto from 'expo-crypto';
import { polyfillWebCrypto } from 'expo-standard-web-crypto';

/**
 * Supabase PKCE needs crypto.getRandomValues + crypto.subtle.digest('SHA-256').
 * Expo Go has neither by default; without subtle it falls back to "plain" PKCE.
 */
polyfillWebCrypto();

function installSubtleDigest() {
  const cryptoObj = (globalThis as typeof globalThis & { crypto?: Crypto }).crypto;
  if (!cryptoObj) {
    return;
  }
  if (cryptoObj.subtle != null && typeof cryptoObj.subtle.digest === 'function') {
    return;
  }

  const subtle = {
    digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
      const name = typeof algorithm === 'string' ? algorithm : (algorithm as Algorithm).name;
      if (name !== 'SHA-256') {
        return Promise.reject(new Error(`Unsupported digest algorithm: ${String(name)}`));
      }

      const view =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(
              (data as ArrayBufferView).buffer,
              (data as ArrayBufferView).byteOffset,
              (data as ArrayBufferView).byteLength,
            );
      const bytes = new Uint8Array(view.byteLength);
      bytes.set(view);

      return ExpoCrypto.digest(ExpoCrypto.CryptoDigestAlgorithm.SHA256, bytes);
    },
  } as SubtleCrypto;

  try {
    Object.defineProperty(cryptoObj, 'subtle', {
      configurable: true,
      enumerable: true,
      value: subtle,
    });
  } catch {
    (cryptoObj as Crypto & { subtle: SubtleCrypto }).subtle = subtle;
  }
}

if (Platform.OS !== 'web') {
  installSubtleDigest();
}
