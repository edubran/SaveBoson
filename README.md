# Boson Save

**After Effects project manager script — standardized saving, version navigation, and footage tools.**

Developed by [Eduardo Brandao](mailto:eduardo@bosonpost.com.br) — [Boson Post](https://bosonpost.com.br)

---

## Overview

Boson Save is a ScriptUI panel for After Effects that centralizes the most repetitive project management tasks in a VFX/motion pipeline:

- Save projects with a standardized naming convention
- Navigate footage versions up and down (with full-path versioning support)
- Replace footage with solid color placeholders for lightweight previews
- Apply masks and convert layers to editable text in batch
- Remember recent save folders across sessions

https://github.com/user-attachments/assets/273e6050-12e4-409e-b06c-f963b860d321

---

## Installation

### Requirements

- After Effects CC 2014 (v13.0) or later
- Windows or macOS

### Enable Script Access (required)

Before installing, make sure After Effects is allowed to read and write files:

1. Open After Effects
2. Go to **Edit > Preferences > Scripting & Expressions** (Windows) or **After Effects > Preferences > Scripting & Expressions** (macOS)
3. Enable **Allow Scripts to Write Files and Access Network**
4. Click OK

### Install as Docked Panel (recommended)

1. Copy `Save_Boson.jsx` to the After Effects **ScriptUI Panels** folder:

   **Windows:**
   ```
   C:\Program Files\Adobe\Adobe After Effects <version>\Support Files\Scripts\ScriptUI Panels\
   ```

   **macOS:**
   ```
   /Applications/Adobe After Effects <version>/Scripts/ScriptUI Panels/
   ```

2. Restart After Effects
3. Go to **Window** menu — `Save_Boson` will appear at the bottom of the list
4. Click it to open the panel; dock it anywhere in your workspace

### Run as Script (alternative)

Go to **File > Scripts > Run Script File** and select `Save_Boson.jsx`. The panel opens as a floating dialog.

---

## Interface

```
┌─────────────────────────────────────────┐
│ [Folder]  [Recent ▾]  .../project/comp  │
├─────────────────────────────────────────┤
│  Save                                   │
│    Name     [________________]          │
│    Type     [________________]          │
│    Version  [________________]          │
│                                         │
│ [Save]                                  │
├─────────────────────────────────────────┤
│  Functions                              │
│ [Version Up] [Version Down] [PlaceHold] │
│ [Mask It]    [Edit It]                  │
├─────────────────────────────────────────┤
│   Eduardo Brandao | eduardo@bosonpost   │
└─────────────────────────────────────────┘
```

---

## Features

### Save Project

Saves the current After Effects project with a standardized filename built from three fields:

```
{Name}_{Type}_{Version}.aep
```

**Examples:**
```
ShotFX_comp_v001.aep
Logo_motion_v003.aep
MainTitle_v001.aep
```

| Field | Description |
|---|---|
| Name | Project or shot identifier |
| Type | Descriptor such as `comp`, `motion`, `render` (optional) |
| Version | Version token, e.g. `v001`, `v002` |

The selected folder is remembered between sessions. If Type is left blank it is omitted from the filename.

---

### Folder & Recent Folders

**Folder button** — Opens the OS native folder picker to select a new save destination.

**Recent ▾ button** — Opens a custom in-AE dialog showing up to 5 previously used folders. Each entry displays the last 4 path segments so the project root is identifiable. The full path is shown below the list when an entry is selected.

- Double-click an entry to select it immediately
- Use **Browse...** inside the dialog to open the native picker
- Recents are persisted to disk and survive AE restarts

---

### Version Up / Version Down

Replaces selected footage items in the Project panel with the next higher or lower version found on disk.

**Supports two naming conventions:**

| Convention | Example |
|---|---|
| Pipeline standard (3-digit) | `shot_comp_v003.exr` |
| Legacy (2-digit trailing) | `shot_comp03.exr` |

**Full-path versioning** — If version tokens also appear in folder names, all segments of the path are updated together:

```
Before:  J:/project/v003/shots/shot_comp_v003.exr
After:   J:/project/v004/shots/shot_comp_v004.exr
```

**Behavior:**
- Works recursively through Project panel folders
- Skips solids and non-footage items automatically
- Silent on successful updates — no interruptions during batch operations
- Shows a single summary alert only when an item has no further version available in that direction (already at latest or oldest)
- Supports non-sequential versions (e.g. v001, v003, v007 — no gaps cause errors)

**How to use:**
1. Select one or more footage items or folders in the Project panel
2. Click **Version Up** or **Version Down**

---

### PlaceHold

Replaces selected footage items with solid color placeholders (Boson blue) while keeping the original footage linked as a proxy. Useful for sharing lightweight project files or working on slow machines.

**How to use:**
1. Select footage items or folders in the Project panel
2. Click **PlaceHold**
3. Optionally enter custom Width, Height, and FPS when prompted (defaults: 1920×1080, 24fps)

**Behavior:**
- Only replaces items with actual file sources (skips solids and existing placeholders)
- Works recursively through folders
- Original item names are preserved after replacement
- Supports image sequences

---

### Mask It

Applies a new mask to each selected layer in the active composition.

**How to use:**
1. Select one or more layers in the Timeline
2. Click **Mask It**

---

### Edit It

Converts selected layers to editable text. Equivalent to **Layer > Create > Convert to Editable Text** applied in batch.

**How to use:**
1. Select one or more layers in the Timeline
2. Click **Edit It**

---

## Settings Persistence

Boson Save stores its settings (last folder, recent folders, defaults) in two places simultaneously:

- **JSON file:** `%APPDATA%\BosonSave_settings.json` (Windows) / `~/Library/Application Support/BosonSave_settings.json` (macOS)
- **AE Preferences:** via `app.settings` as a secondary layer

On every launch, the JSON file is read first. If it is missing or corrupt, the AE preferences are used as fallback. This dual-layer approach means settings survive even if one storage method fails.

---

## Naming Convention Reference

```
{Name}_{Type}_{Version}.aep

ShotFX_comp_v001.aep      ← Name=ShotFX, Type=comp, Version=v001
Logo_v003.aep             ← Name=Logo, Type omitted, Version=v003
```

Footage versioning pattern (pipeline standard):
```
{BaseName}_v{###}{extension}
shot_comp_v001.exr
shot_comp_v002.exr
```

---

## Compatibility

| After Effects Version | Status |
|---|---|
| CC 2014 (13.0) and later | Supported |
| CS6 and earlier | Not supported |

---

## Changelog

### v4.0
- **Full-path versioning:** `_v###` tokens in folder segments are now replaced alongside the filename
- **Version boundary alert:** silent on success; single alert only when no further version exists in that direction

### v3.9
- Boundary alert collected across all items instead of firing per-item mid-loop

### v3.8
- Recent folders now read fresh from disk on every click, fixing stale state on panel startup

### v3.7 / v3.6 / v3.5
- Settings persistence fixes: encoding, array context bug, `app.settings` dual-layer

### v3.4
- Fixed `recentFolders instanceof Array` failing across ExtendScript execution contexts

### v3.3
- Added `app.settings` as secondary persistence layer alongside JSON file

### v3.2
- Recent folders list now shows last 4 path segments
- Full path displayed below list on selection

### v3.1
- Fixed `successCount` always being 0 in recursive version operations
- Fixed `checkCompatibility` version string parsing
- Fixed `findMenuCommandId` called inside loop (now cached)
- Artist field removed from UI and filename convention
- Recent Folders system added (up to 5 entries)
- All UI text in English

---

## Author

**Eduardo Brandao**  
[eduardo@bosonpost.com.br](mailto:eduardo@bosonpost.com.br)

Did this tool help you?
You can buy me a coffee via PayPal at eduardo@bosonpost.com.br
or by purchasing my book.
https://vfxebook-9dqwsk8s.manus.space/


## License

MIT License — free to use, modify, and distribute with attribution.
