/**
 * CryptIO Settings - ComfyUI Settings Integration
 * Rich key management UI using custom renderer in the settings panel
 */
//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
import { CLIENT_KEYPAIR_STORAGE_KEY, SERVER_KEYS_STORAGE_KEY, } from "./utils/cryptoKeys.js";
const app = rawApp;
const SETTINGS_STYLES = `
.cryptio-settings {
    display: flex;
    flex-direction: column;
    gap: 18px;
    width: 100%;
}
.cryptio-section-title {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #8a8a8a);
    margin-bottom: 2px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle, #3c3d42);
}
.cryptio-section-title-danger {
    color: var(--destructive-background, #f75951);
    border-bottom-color: var(--destructive-background, #f75951);
}
.cryptio-status-card {
    padding: 12px 14px;
    border-radius: 8px;
    border: 1px solid var(--border-subtle, #3c3d42);
    background: var(--secondary-background, #262729);
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.cryptio-status-row {
    display: flex;
    align-items: center;
    gap: 8px;
}
.cryptio-status-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
}
.cryptio-status-label {
    font-weight: 500;
    color: var(--base-foreground, #fff);
}
.cryptio-status-detail {
    color: var(--text-muted, #8a8a8a);
    font-size: 12px;
    margin-left: auto;
    text-align: right;
}
.cryptio-btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.cryptio-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    border: 1px solid var(--border-default, #494a50);
    border-radius: 6px;
    background: var(--base-background, #171718);
    color: var(--base-foreground, #fff);
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s, opacity 0.15s;
    line-height: 1.4;
}
.cryptio-btn:hover {
    background: var(--secondary-background-hover, #313235);
    border-color: var(--p-primary-color, #0b8ce9);
}
.cryptio-btn:active {
    opacity: 0.85;
}
.cryptio-btn i {
    font-size: 14px;
}
.cryptio-btn-primary {
    background: var(--p-primary-color, #0b8ce9);
    color: #fff;
    border-color: var(--p-primary-color, #0b8ce9);
}
.cryptio-btn-primary:hover {
    background: var(--p-primary-hover-color, #185a8b);
    border-color: var(--p-primary-hover-color, #185a8b);
}
.cryptio-btn-danger {
    background: var(--destructive-background, #b33a3a);
    color: #fff;
    border-color: var(--destructive-background, #b33a3a);
}
.cryptio-btn-danger:hover {
    filter: brightness(1.15);
}
`;
function injectStyles() {
    if (document.getElementById("cryptio-settings-styles"))
        return;
    const style = document.createElement("style");
    style.id = "cryptio-settings-styles";
    style.textContent = SETTINGS_STYLES;
    document.head.appendChild(style);
}
// ──────────────────────────────────────────────
//  Helpers
// ──────────────────────────────────────────────
function getExtMgr() {
    return app.extensionManager;
}
function showToast(message, severity = "info") {
    const em = getExtMgr();
    if (em?.toast?.add) {
        em.toast.add({ severity, summary: "CryptIO", detail: message, life: 3000 });
    }
}
async function showConfirm(title, message) {
    const em = getExtMgr();
    if (em?.dialog?.confirm) {
        try {
            const result = await em.dialog.confirm({ title, message });
            return result === true;
        }
        catch {
            return false;
        }
    }
    return window.confirm(message);
}
function downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
function readJSONFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result);
                resolve(data);
            }
            catch {
                reject(new Error("Invalid JSON file"));
            }
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
}
function createFileInput(id, onChange) {
    const existing = document.getElementById(id);
    if (existing)
        existing.remove();
    const input = document.createElement("input");
    input.type = "file";
    input.id = id;
    input.accept = ".json";
    input.style.display = "none";
    input.addEventListener("change", (event) => {
        onChange(event);
        input.remove();
    });
    document.body.appendChild(input);
    return input;
}
function triggerFileUpload(id, handler) {
    const input = createFileInput(id, handler);
    input.click();
}
function getKeyInfo(storageKey) {
    const raw = localStorage.getItem(storageKey);
    if (!raw)
        return { present: false, keyType: "" };
    try {
        const data = JSON.parse(raw);
        const pubKey = data.publicKey || "";
        if (pubKey.includes("RSA"))
            return { present: true, keyType: "RSA" };
        if (pubKey.includes("PUBLIC"))
            return { present: true, keyType: "Public Key" };
        return { present: true, keyType: "Configured" };
    }
    catch {
        return { present: false, keyType: "" };
    }
}
// ──────────────────────────────────────────────
//  Action handlers
// ──────────────────────────────────────────────
async function handleGenerate() {
    const confirmed = await showConfirm("Generate New Client Keys", "This will overwrite your existing client keypair and cannot be undone. Continue?");
    if (!confirmed)
        return;
    try {
        const { generateClientKeyPair } = await import("./utils/cryptoKeys.js");
        const keyPair = await generateClientKeyPair();
        localStorage.setItem(CLIENT_KEYPAIR_STORAGE_KEY, JSON.stringify(keyPair));
        showToast("New client keys generated", "success");
    }
    catch (error) {
        showToast(`Failed to generate keys: ${error}`, "error");
    }
}
async function handleClear() {
    const confirmed = await showConfirm("Clear All Keys", "This will remove all CryptIO keys from localStorage. This action cannot be undone.");
    if (!confirmed)
        return;
    localStorage.removeItem(CLIENT_KEYPAIR_STORAGE_KEY);
    localStorage.removeItem(SERVER_KEYS_STORAGE_KEY);
    showToast("All keys cleared", "success");
}
function handleDownloadClient() {
    const raw = localStorage.getItem(CLIENT_KEYPAIR_STORAGE_KEY);
    if (raw) {
        downloadJSON(JSON.parse(raw), "cryptio-client-keypair.json");
        showToast("Client keys downloaded", "success");
    }
    else {
        showToast("No client keys found", "error");
    }
}
function handleDownloadServer() {
    const raw = localStorage.getItem(SERVER_KEYS_STORAGE_KEY);
    if (raw) {
        downloadJSON(JSON.parse(raw), "cryptio-server-keys.json");
        showToast("Server keys downloaded", "success");
    }
    else {
        showToast("No server keys found", "error");
    }
}
async function handleUploadClient(event) {
    const file = event.target.files?.[0];
    if (!file)
        return;
    try {
        const data = await readJSONFile(file);
        if (data.publicKey && data.privateKey) {
            localStorage.setItem(CLIENT_KEYPAIR_STORAGE_KEY, JSON.stringify(data));
            showToast("Client keys uploaded", "success");
        }
        else {
            showToast("Invalid key format — must contain publicKey and privateKey", "error");
        }
    }
    catch (error) {
        showToast(`Failed to upload: ${error}`, "error");
    }
}
async function handleUploadServer(event) {
    const file = event.target.files?.[0];
    if (!file)
        return;
    try {
        const data = await readJSONFile(file);
        if (data.publicKey && data.privateKey) {
            localStorage.setItem(SERVER_KEYS_STORAGE_KEY, JSON.stringify(data));
            showToast("Server keys uploaded", "success");
        }
        else {
            showToast("Invalid key format — must contain publicKey and privateKey", "error");
        }
    }
    catch (error) {
        showToast(`Failed to upload: ${error}`, "error");
    }
}
// ──────────────────────────────────────────────
//  DOM builders
// ──────────────────────────────────────────────
function el(tag, className, text) {
    const e = document.createElement(tag);
    e.className = className;
    if (text !== undefined)
        e.textContent = text;
    return e;
}
function makeSectionTitle(text, variant) {
    if (variant === "danger")
        return el("div", "cryptio-section-title cryptio-section-title-danger", text);
    return el("div", "cryptio-section-title", text);
}
function makeButton(text, icon, variant, onClick) {
    const btn = document.createElement("button");
    btn.className = "cryptio-btn";
    if (variant === "primary")
        btn.classList.add("cryptio-btn-primary");
    if (variant === "danger")
        btn.classList.add("cryptio-btn-danger");
    const i = document.createElement("i");
    i.className = icon;
    btn.appendChild(i);
    btn.appendChild(document.createTextNode(" " + text));
    btn.addEventListener("click", onClick);
    return btn;
}
function makeButtonRow(buttons) {
    const row = el("div", "cryptio-btn-row");
    buttons.forEach((b) => row.appendChild(b));
    return row;
}
function makeStatusCard(items) {
    const card = el("div", "cryptio-status-card");
    items.forEach((item) => {
        const row = el("div", "cryptio-status-row");
        const dot = el("span", "cryptio-status-dot");
        dot.style.backgroundColor = item.present
            ? "var(--success-background, #00cd72)"
            : "var(--text-muted, #8a8a8a)";
        row.appendChild(dot);
        row.appendChild(el("span", "cryptio-status-label", item.label));
        row.appendChild(el("span", "cryptio-status-detail", item.detail));
        card.appendChild(row);
    });
    return card;
}
// ──────────────────────────────────────────────
//  Custom renderer (SettingCustomRenderer)
// ──────────────────────────────────────────────
function renderCryptIOSettings(_name, _setter, _value, _attrs) {
    const container = el("div", "cryptio-settings");
    const clientInfo = getKeyInfo(CLIENT_KEYPAIR_STORAGE_KEY);
    const serverInfo = getKeyInfo(SERVER_KEYS_STORAGE_KEY);
    // ── Key Status ──
    container.appendChild(makeSectionTitle("Key Status"));
    container.appendChild(makeStatusCard([
        {
            present: clientInfo.present,
            label: "Client Key",
            detail: clientInfo.present
                ? `${clientInfo.keyType} keypair configured`
                : "Not configured",
        },
        {
            present: serverInfo.present,
            label: "Server Key",
            detail: serverInfo.present
                ? `${serverInfo.keyType} keypair configured`
                : "Not configured",
        },
    ]));
    // ── Client Keys ──
    container.appendChild(makeSectionTitle("Client Keys"));
    container.appendChild(makeButtonRow([
        makeButton("Generate New", "pi pi-refresh", "primary", () => handleGenerate()),
        makeButton("Download", "pi pi-download", "default", () => handleDownloadClient()),
        makeButton("Upload", "pi pi-upload", "default", () => triggerFileUpload("cryptio-client-upload", handleUploadClient)),
    ]));
    // ── Server Keys ──
    container.appendChild(makeSectionTitle("Server Keys"));
    container.appendChild(makeButtonRow([
        makeButton("Download", "pi pi-download", "default", () => handleDownloadServer()),
        makeButton("Upload", "pi pi-upload", "default", () => triggerFileUpload("cryptio-server-upload", handleUploadServer)),
    ]));
    // ── Danger Zone ──
    container.appendChild(makeSectionTitle("Danger Zone", "danger"));
    container.appendChild(makeButtonRow([
        makeButton("Clear All Keys", "pi pi-trash", "danger", () => handleClear()),
    ]));
    return container;
}
// ──────────────────────────────────────────────
//  Extension registration
// ──────────────────────────────────────────────
app.registerExtension({
    name: "cryptio.Settings",
    settings: [
        {
            id: "cryptio.category",
            name: "CryptIO Settings",
            type: "hidden",
            defaultValue: "",
            category: ["CryptIO🔒", "Key Management"],
        },
        {
            id: "cryptio.key_management",
            name: "Key Management",
            type: renderCryptIOSettings,
            defaultValue: null,
            category: ["CryptIO🔒", "Key Management"],
        },
    ],
    async setup() {
        injectStyles();
        console.log("[CryptIO] Settings extension loaded");
    },
});
