# Image Downloader

A Chrome (Manifest V3) extension that downloads images with a single Alt+Click,
including on pages that try to block saving through right-click menus, drag
blocking, transparent overlays, or hotlink (Referer) protection.

## Capabilities

- Alt+Click any image to download it immediately.
- Sees through anti-save tricks:
  - Right-click, drag, and selection blocking are irrelevant because the
    extension acts on an Alt+Click captured before the page's own handlers.
  - Finds the real `<img>` even when a transparent overlay is placed on top of
    it (uses the full element stack at the click point).
  - Extracts the URL from a CSS `background-image` when the element is not an
    `<img>` tag.
- Bypasses hotlink protection by sending the page URL as the `Referer` header
  for the image request (via `declarativeNetRequest`), so images that only load
  with a valid referrer still download.
- Chooses the filename and destination reliably through
  `chrome.downloads.onDeterminingFilename`, avoiding Chrome's generic default
  name for fetched content.
- Configurable subfolder inside the Downloads directory, with dynamic tokens:
  - `{domain}` is replaced with the source page's domain.
  - `{title}` is replaced with the source page's title.
  - Tokens can be combined and nested, for example `{domain}/{title}`.
  - Leave the field empty to save directly into the Downloads root.
- Automatic filename de-duplication (Chrome's `uniquify` conflict action).
- Multilingual UI (English, Korean, Chinese) selected automatically from the
  browser language.

## Installation

1. Open `chrome://extensions`.
2. Enable Developer mode (top right).
3. Click "Load unpacked" and select this folder (`image-downloader`).
4. Optional: open the toolbar puzzle icon and pin the extension for quick
   access to its settings.

## Usage

1. Click the extension's toolbar icon to open the settings popup.
2. Set the subfolder name (or leave it empty). Examples:
   - empty: saves to the Downloads root.
   - `{domain}`: saves to `Downloads/<site-domain>/`.
   - `{domain}/{title}`: saves to `Downloads/<site-domain>/<page-title>/`.
   - `MyImages`: saves to `Downloads/MyImages/`.
3. On any web page, hold Alt and click an image to download it.

Note: Alt+Click is used without Ctrl so it does not overlap with the companion
Video Downloader extension (which uses Ctrl+Alt+Click).

## Settings

The subfolder value is stored with `chrome.storage.sync`, so it follows your
Chrome profile across signed-in devices. Path segments are sanitized: characters
that are illegal on Windows/macOS are replaced, trailing dots and spaces are
trimmed, and directory traversal (`..`) is neutralized.

## Localization

UI strings live in `_locales/<lang>/messages.json` for `en`, `ko`, and `zh`, and
are referenced from the manifest with `__MSG_*__` placeholders and from the popup
via `data-i18n` attributes. Chrome picks the language from the browser UI
language and falls back to English.

## Permissions

- `downloads`: save files and control the destination filename/subfolder.
- `storage`: persist the subfolder setting.
- `declarativeNetRequest`: set the `Referer` request header to bypass hotlink
  protection.
- `host_permissions: <all_urls>`: run the content script and fetch images on any
  site the user visits.

## Limitations

- The image is fetched in the background and written via a data URL; this is
  fine for images but is not intended for very large binary files.
- Only the first `url(...)` of a CSS `background-image` is used; gradients and
  image sets are ignored.
- Canvas-rendered images (pixels drawn into a `<canvas>`) are not captured.
- Files can only be saved inside the browser's Downloads directory; Chrome does
  not allow extensions to write to arbitrary absolute paths.

## License

Licensed under the Apache License, Version 2.0. See the [LICENSE](LICENSE) file
for details.
