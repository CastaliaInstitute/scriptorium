import * as React from 'react';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { ViewTransitions } from 'next-view-transitions';
import { EnvProvider } from '@/context/EnvContext';
import Providers from '@/components/Providers';

import '../styles/globals.css';

const pagesBasePath = process.env['GITHUB_PAGES_BASE_PATH'] ?? '';
const url = 'https://castaliainstitute.github.io/scriptorium/';
const title = 'Castalia Scriptorium';
const description =
  'Castalia Scriptorium is a bookmaking environment for reading, annotation, review, and publication.';
const previewImage = `${url}icon.png`;

export const metadata: Metadata = {
  metadataBase: new URL(url),
  title: {
    default: title,
    template: '%s | Scriptorium',
  },
  description,
  generator: 'Next.js',
  manifest: `${pagesBasePath}/manifest.json`,
  keywords: ['epub', 'pdf', 'ebook', 'reader', 'scriptorium', 'castalia', 'pwa'],
  authors: [
    {
      name: 'Castalia Institute',
      url: 'https://github.com/CastaliaInstitute/scriptorium',
    },
  ],
  icons: {
    icon: [{ url: `${pagesBasePath}/icon.png` }, { url: `${pagesBasePath}/favicon.ico` }],
    apple: [{ url: `${pagesBasePath}/apple-touch-icon.png`, sizes: '180x180' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Scriptorium',
    statusBarStyle: 'default',
  },
  openGraph: {
    type: 'website',
    url,
    title,
    description,
    images: [previewImage],
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    images: [previewImage],
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'twitter:domain': 'castaliainstitute.github.io',
    'twitter:url': url,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  // `interactive-widget=resizes-content` is appended client-side on
  // Android only — see Providers.tsx. Other browsers warn about the
  // unrecognized key on every page load, so we keep it out of SSR.
};

// In Tauri mobile dev the page origin doesn't match the dev server, so
// Next.js's `getSocketUrl` builds an unreachable HMR URL (see
// `next/dist/client/dev/hot-reloader/get-socket-url.js`):
//   - iOS sim:        page at `tauri://localhost`        → `wss://localhost/_next/...`
//     (no port, non-http scheme falls through to `wss:`)
//   - Android emul.:  page at `http://tauri.localhost`   → `ws://tauri.localhost/_next/...`
//     (`tauri.localhost` is intercepted by Tauri's asset handler, but
//     WebSocket frames bypass the interceptor and the dev server is on the
//     host machine, reachable from the emulator as `10.0.2.2`)
// Rewrite the WebSocket constructor before the HMR client runs.
// When `--host <ip>` is passed, tauri-cli exports `TAURI_DEV_HOST=<ip>`
// before invoking `beforeDevCommand`, so we forward that as `devHost` and
// use it for the rewrite (the dev server must also bind to the same address
// — typically `next dev -H 0.0.0.0`).
function patchTauriHmrWebSocket(devHost?: string) {
  const isIosTauriProxy = location.protocol === 'tauri:' && location.hostname === 'localhost';
  const isAndroidTauriProxy =
    location.protocol === 'http:' && location.hostname === 'tauri.localhost';
  if (!isIosTauriProxy && !isAndroidTauriProxy) return;

  // Priority: explicit --host > platform default loopback alias.
  // iOS Simulator can reach the host's localhost directly.
  // Android emulator reaches the host machine via 10.0.2.2.
  const hmrHost = devHost
    ? `${devHost}:3000`
    : isIosTauriProxy
      ? 'localhost:3000'
      : '10.0.2.2:3000';
  const brokenHostPattern = /^wss?:\/\/(localhost|tauri\.localhost)(?=\/_next\/)/;

  const OriginalWebSocket = window.WebSocket;
  class PatchedWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const urlStr = url instanceof URL ? url.href : url;
      const rewritten =
        typeof urlStr === 'string' && brokenHostPattern.test(urlStr)
          ? urlStr.replace(brokenHostPattern, `ws://${hmrHost}`)
          : url;
      super(rewritten, protocols);
    }
  }
  window.WebSocket = PatchedWebSocket;
}

const shouldInjectDevHmrPatch =
  process.env['NODE_ENV'] === 'development' && process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';
const devHmrPatchScript = `(${patchTauriHmrWebSocket.toString()})(${JSON.stringify(
  process.env['TAURI_DEV_HOST'],
)});`;

// `/runtime-config.js` is a dynamic route handler that only exists in the
// web/Docker build. The Tauri build is statically exported (`output:
// 'export'`), so the file isn't emitted — the request would return the SPA
// fallback HTML and crash with `Unexpected token '<'`. All runtime-config
// consumers fall back to `NEXT_PUBLIC_*` envs baked at build time on Tauri.
const shouldInjectRuntimeConfig = process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang='en'
      className={process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri' ? 'edge-to-edge' : ''}
    >
      <head>
        {shouldInjectRuntimeConfig ? (
          <Script src='/runtime-config.js' strategy='beforeInteractive' />
        ) : null}
        {shouldInjectDevHmrPatch ? (
          <script dangerouslySetInnerHTML={{ __html: devHmrPatchScript }} />
        ) : null}
      </head>
      <body>
        <ViewTransitions>
          <EnvProvider>
            <Providers>{children}</Providers>
          </EnvProvider>
        </ViewTransitions>
      </body>
    </html>
  );
}
