# PWA setup

The single Next.js website is installable where the browser and operating system support installation. It publishes the web manifest from `src/app/manifest.ts`, PNG icons at 192×192 and 512×512 (standard and maskable), and service worker `/sw.js`.

The service worker precaches only `/offline`. It may cache same-origin Next static assets and icon files after successful network fetch. It does not cache API paths, Next data, page navigations, authentication, sessions, patient profile content, or health information. Navigations require a network response and use the generic offline page only when the network is unavailable. Offline medical information is not supported.

Service workers and installation need HTTPS, except localhost for development. Chromium may emit `beforeinstallprompt`, which is exposed through an Install app button. Safari on iOS/iPadOS usually offers Share → Add to Home Screen instead. Behavior and prompts vary by browser and OS.

Medical reports use a browser file picker and the optional `capture="environment"` hint on the upload input. Camera support is browser-dependent; the ordinary file picker remains available as a fallback. The PWA does not store report files offline or in browser persistence.
