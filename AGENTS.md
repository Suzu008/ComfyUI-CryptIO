# CryptIO Development Guide

> **Keep this file in sync.** When architecture, commands, references, or conventions change, update this file so future sessions stay accurate.

## Quick Commands

```bash
# Python: dev install (live-reload on ComfyUI restart)
pip install -e .[dev]

# TypeScript: compile to js/
cd ts && pnpm build

# TypeScript: type-check only (no emit)
cd ts && pnpm check

# Lint (ruff check --fix) + format (ruff format)
pre-commit run --all-files

# Lint only (CI does this)
ruff check .
```

**To test changes**: restart ComfyUI. Python changes are picked up via editable install. JS changes are served from `./js` (set by `WEB_DIRECTORY`).

---

## Architecture

### Encryption Flow

```
Upload:  Browser --[server public key]--> AES-GCM encrypt --> Server decrypts with server private key
Output:  Server --[client public key]--> AES-GCM encrypt --> Browser decrypts with client private key
KeyEx:   Browser sends client pubkey --> Server sends encrypted server keypair (RSA+AES-CBC)
```

- **Server keypair** → `keys/keys.json` (auto-generated on first run, gitignored via `/keys`)
- **Key store at runtime** → ComfyUI's system user directory (`folder_paths.get_system_user_directory()/cryptio/keys/`), NOT the repo's `keys/`
- **Client keypair** → browser `localStorage` (`cryptio_client_keypair`, `cryptio_server_keys`)
- **Crypto primitives**: RSA-2048 for key wrapping, AES-GCM for data, AES-CBC for key exchange

### Nodes (all V3 `io.ComfyNode`)

All nodes use the V3 pattern: `define_schema()` (Schema + widget inputs), `execute()`, `fingerprint_inputs()`, `validate_inputs()`.

| File | Nodes | Output Types |
|------|-------|-------------|
| `text_crypt.py` | TextEncrypt, TextDecrypt | String |
| `upload_image.py` | UploadImageCryptIO | Image + Mask |
| `save_image.py` | SaveImageCryptIO, PreviewImageCryptIO | UI (cryptio_images) |
| `upload_video.py` | UploadVideoCryptIO | Video |
| `save_video.py` | SaveVideoCryptIO, PreviewVideoCryptIO | UI (cryptio_images, animated) |

### Extension Registration

`__init__.py` uses `comfy_entrypoint()` returning a `ComfyExtension` subclass. Nodes are registered via `get_node_list()` returning `NODE_CLASS_MAPPINGS.values()`. The old `NODE_CLASS_MAPPINGS` + `NODE_DISPLAY_NAME_MAPPINGS` dicts are still defined in `nodes.py` for backwards compat.

### Key Manager

`KeyManager` is a singleton (`src/cryptio/utils/key_utils.py`). It caches keys in memory and checks file mtime to detect external changes. The global instance is `_key_manager`.

### File Layout

```
__init__.py            # WEB_DIRECTORY = "./js", comfy_entrypoint, ComfyExtension
src/cryptio/
  nodes.py             # Node class imports + NODE_CLASS_MAPPINGS/NODE_DISPLAY_NAME_MAPPINGS
  api.py               # HTTP routes: /cryptio/exchange_keys, /upload_encrypted, /view_encrypted
  text_crypt.py        # TextEncrypt, TextDecrypt
  upload_image.py      # UploadImageCryptIO
  save_image.py        # SaveImageCryptIO, PreviewImageCryptIO
  upload_video.py      # UploadVideoCryptIO
  save_video.py        # SaveVideoCryptIO, PreviewVideoCryptIO
  utils/
    crypto_utils.py    # RSA+AES-GCM hybrid encrypt/decrypt, AES-CBC helpers
    key_utils.py       # KeyManager singleton

ts/                   # TypeScript source (compiled to js/)
  cryptioSettings.ts  # Settings panel UI
  cryptioUploadImage.ts / cryptioUploadVideo.ts   # Upload nodes
  cryptioSaveImage.ts / cryptioSaveVideo.ts        # Save/Preview nodes
  textEncrypt.ts       # Text encrypt node
  utils/              # cryptoKeys, cryptoUtils, uploadUtils, fileUtils, loaders

js/                   # Compiled JS (served to browser, WEB_DIRECTORY); not in .gitignore
```

---

## References

All references are **read-only** — do not modify files in these locations.

- **ComfyUI node development skills** available in `.agents/skills/` (basics, inputs, outputs, datatypes, lifecycle, frontend, advanced, migration, packaging). Use the `skill` tool to load them when needed.
- **ComfyUI**: `D:\CODE\ComfyUI` — the ComfyUI installation directory. Reference for `folder_paths`, `comfy_api`, base types, and node infrastructure.
- **ComfyUI frontend source**: `D:\CODE\ComfyUI_frontend` — consult when debugging frontend integration (settings system, node UI, extension APIs).

## CI

- **build-pipeline.yml**: runs on PR to main/master — `ruff check .` then `pytest tests/`
- **validate.yml**: runs node-diff for backwards compatibility on PR
- **publish_node.yml**: publishes to Comfy registry

Note: `tests/` directory exists but is currently empty.

---

## Settings / Frontend Customization

### SettingCustomRenderer API

CryptIO uses custom DOM rendering for settings instead of built-in toggle/select types:

```typescript
// type must be a function returning HTMLElement, NOT "boolean" or "combo"
{
  id: "cryptio.key_management",
  type: renderCryptIOSettings,  // (name, setter, value, attrs?) => HTMLElement
  defaultValue: null,
  category: ["CryptIO🔒", "Key Management"],
}
```

Called by `FormItem.vue` -> `CustomFormValue.vue` in ComfyUI frontend.

### Category / Nav Structure

- `category` **must have >= 2 levels** for a setting to appear as a nav tree node. Single-element `["CryptIO🔒"]` becomes a "floating" leaf under "Other".
- Dedicated nav group for CryptIO required modifying `useSettingUI.ts` in ComfyUI frontend — not part of this repo.

### ComfyUI APIs (prefer these over raw DOM)

```typescript
// Toasts
app.extensionManager.toast.add({ severity, summary, detail, life })

// Confirmation dialogs (instead of window.confirm)
app.extensionManager.dialog.confirm({ title, message })

// Setting access
app.extensionManager.setting.set("id", value)
```

### Styling

Inject a `<style>` element in `setup()`. Use ComfyUI CSS variables:

| Variable | Purpose |
|----------|---------|
| `--p-primary-color` | Accent / button primary |
| `--base-background` | Card background |
| `--base-foreground` | Text color |
| `--secondary-background` | Subtle card background |
| `--border-default` / `--border-subtle` | Borders |
| `--text-muted` | Secondary text |
| `--destructive-background` | Danger/delete |
| `--success-background` | Success |

Use `pi pi-*` classes for PrimeIcons (e.g. `pi pi-refresh`, `pi pi-download`, `pi pi-trash`).

---

## Interaction Rules

- **Answer first, then act.** When the user asks a question or reports an issue, always respond to the question first before making any code changes. Do not jump directly into editing files. This includes informational queries, clarifications, and requests for references.
- When the user assigns a task, proceed directly — no need to pre-confirm.

## Gotchas

- **ComfyUI restart needed** for any Python changes or recompiled JS. No hot reload.
- **`category` must have >= 2 levels** for a setting to appear as a non-leaf nav node.
- The `app` singleton from `../../scripts/app.js` may not have `extensionManager` populated at module load time. Access it lazily inside functions.
- Encrypted files are named `<original>.encrypted` on disk. The browser strips `.encrypted` suffix after decryption for display.
- All `.encrypted` files in the input directory appear as selectable Combo options in Upload nodes.
- **Save/Preview nodes** output encrypted files to disk; decryption happens in the browser via the TS frontend.
- **Upload nodes** read encrypted files from disk, decrypt them server-side using `_key_manager.server_private_key`.
- Save nodes require client public key (established via key exchange when first upload occurs). They will raise `ValueError` if it's missing.
- `ruff` config targets `py39` in `pyproject.toml` but `requires-python` is `>=3.10`. Do not use `match`/`case` without verifying.
