# Image Downloader

A Chrome (Manifest V3) extension that downloads images from a page — including
sites that block right-click/drag, hide the image under an overlay, or require a
Referer (hotlink protection).

## Install

1. `chrome://extensions` -> enable Developer mode -> **Load unpacked** -> this folder.
2. (Optional) pin the toolbar icon.

## Usage

Three ways to download, plus a Settings tab, all in the popup (toolbar icon). The
popup has two tabs: **Images** and **Settings**.

### 1. Shortcut (modifier + click on an image)

- Default: **Alt + left click** an image to download it.
- Works through anti-save tricks: it acts on the click before the page's own
  handlers, sees through transparent overlays, and reads CSS `background-image`
  when there is no `<img>`.
- Change the combo in **Settings**.

### 2. On-image button (hover)

- Hover an image; a green **photo** button appears at its top-right.
- Click it to download. The button then shows progress and turns into **Open
  folder** (click to reveal the saved file). If you delete the file, it goes back
  to a download button after a refresh.
- Turn it off in Settings ("Show download button on image").

### 3. Popup list (Images tab)

- Open the popup -> **Images** tab lists the page's images with a thumbnail, name,
  and size.
- Check one or more, then **Download selected**. Each row's button also downloads
  that single image and becomes **Open folder** when done.
- **Refresh** re-scans the page (and drops entries whose file you deleted).
- **Size filter** (top of the tab): tick it and set `W x H` to show only images at
  least that large. Values apply instantly and are remembered.

### Settings tab

- **Save folder / subfolder**: where files go inside Downloads.
  - empty -> Downloads root
  - `MyPics` -> `Downloads/MyPics/`
  - `{domain}` -> `Downloads/<site-domain>/`
  - `{title}` -> `Downloads/<page-title>/`
  - combine/nest, e.g. `{domain}/{title}`
  - Press **Save** (or Enter) to store it.
- **Use download shortcut**: enable/disable the click shortcut.
- **Set the combo**: click the capture box while **holding the modifier keys**, and
  **left- or right-click** it — that exact combo (e.g. `Ctrl + Alt + Right click`)
  is saved immediately. The "How to use" line reflects the current combo.
- **Show download button on image**: toggle the hover button.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
