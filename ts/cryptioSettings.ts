/**
 * CryptIO Settings - ComfyUI Settings Integration
 * Integrates CryptIO key management into ComfyUI's native settings panel
 */

//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
import type {
    ComfyApp,
} from "@comfyorg/comfyui-frontend-types";

import {
    CLIENT_KEYPAIR_STORAGE_KEY,
    SERVER_KEYS_STORAGE_KEY,
    KeyPair,
    ServerKeys
} from "./utils/cryptoKeys.js";

const app: ComfyApp = rawApp;

/**
 * Download JSON file
 */
function downloadJSON(data: any, filename: string): void {
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

/**
 * Read file content as JSON
 */
function readJSONFile(file: File): Promise<any> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target?.result as string);
                resolve(data);
            } catch (error) {
                reject(new Error("Invalid JSON file"));
            }
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
}

/**
 * Show temporary message
 */
function showMessage(message: string, type: "success" | "error" | "info" = "info"): void {
    const colors = {
        success: "#4CAF50",
        error: "#f44336",
        info: "#2196F3"
    };

    const messageEl = document.createElement("div");
    messageEl.textContent = message;
    messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        border-radius: 4px;
        color: white;
        background-color: ${colors[type]};
        z-index: 10001;
        font-family: Arial, sans-serif;
        font-size: 14px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    `;
    document.body.appendChild(messageEl);
    setTimeout(() => {
        messageEl.remove();
    }, 3000);
}

/**
 * Generate new client key pair
 */
async function generateNewClientKeys(): Promise<void> {
    if (confirm("Are you sure you want to generate new client keys? This will overwrite your existing client keypair and cannot be undone.")) {
        try {
            const { generateClientKeyPair } = await import("./utils/cryptoKeys.js");
            const keyPair = await generateClientKeyPair();
            localStorage.setItem(CLIENT_KEYPAIR_STORAGE_KEY, JSON.stringify(keyPair));
            showMessage("New client keys generated successfully!", "success");
        } catch (error) {
            showMessage(`Failed to generate keys: ${error}`, "error");
        }
    }
}

/**
 * Clear all CryptIO keys
 */
function clearAllKeys(): void {
    if (confirm("Are you sure you want to clear all CryptIO keys? This action cannot be undone.")) {
        localStorage.removeItem(CLIENT_KEYPAIR_STORAGE_KEY);
        localStorage.removeItem(SERVER_KEYS_STORAGE_KEY);
        showMessage("All keys cleared successfully!", "success");
    }
}

/**
 * Download client keys
 */
function downloadClientKeys(): void {
    const clientKeys = localStorage.getItem(CLIENT_KEYPAIR_STORAGE_KEY);
    if (clientKeys) {
        downloadJSON(JSON.parse(clientKeys), "cryptio-client-keypair.json");
        showMessage("Client keys downloaded successfully!", "success");
    } else {
        showMessage("No client keys found", "error");
    }
}

/**
 * Download server keys
 */
function downloadServerKeys(): void {
    const serverKeys = localStorage.getItem(SERVER_KEYS_STORAGE_KEY);
    if (serverKeys) {
        downloadJSON(JSON.parse(serverKeys), "cryptio-server-keys.json");
        showMessage("Server keys downloaded successfully!", "success");
    } else {
        showMessage("No server keys found", "error");
    }
}

/**
 * Handle client key file upload
 */
async function handleClientKeyUpload(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
        const data = await readJSONFile(file);
        if (data.publicKey && data.privateKey) {
            localStorage.setItem(CLIENT_KEYPAIR_STORAGE_KEY, JSON.stringify(data));
            showMessage("Client keys uploaded successfully!", "success");
        } else {
            showMessage("Invalid key format. Must contain publicKey and privateKey", "error");
        }
    } catch (error) {
        showMessage(`Failed to upload client keys: ${error}`, "error");
    }
}

/**
 * Handle server key file upload
 */
async function handleServerKeyUpload(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
        const data = await readJSONFile(file);
        if (data.publicKey && data.privateKey) {
            localStorage.setItem(SERVER_KEYS_STORAGE_KEY, JSON.stringify(data));
            showMessage("Server keys uploaded successfully!", "success");
        } else {
            showMessage("Invalid key format. Must contain publicKey and privateKey", "error");
        }
    } catch (error) {
        showMessage(`Failed to upload server keys: ${error}`, "error");
    }
}

/**
 * Create hidden file input for uploads
 */
function createFileInput(id: string, onChange: (event: Event) => void): HTMLInputElement {
    // Remove any existing input with the same id to avoid duplicates
    const existing = document.getElementById(id);
    if (existing) {
        existing.remove();
    }

    const input = document.createElement("input");
    input.type = "file";
    input.id = id;
    input.accept = ".json";
    input.style.display = "none";
    input.addEventListener("change", (event: Event) => {
        onChange(event);
        input.remove();
    });
    document.body.appendChild(input);
    return input;
}

// Register extension with ComfyUI settings
app.registerExtension({
    name: "cryptio.Settings",
    settings: [
        {
            id: "cryptio.category" as any,
            name: "CryptIO Settings",
            type: "hidden",
            defaultValue: "",
            category: ["CryptIO🔒"]
        },
        {
            id: "cryptio.download_client_keys" as any,
            name: "Download Client Keys",
            type: "boolean",
            defaultValue: false,
            category: ["CryptIO🔒", "Client Keys", "Download"],
            tooltip: "Click to download your client keypair as a JSON file",
            onChange: (newVal: boolean, oldVal: boolean) => {
                if (newVal === true) {
                    downloadClientKeys();
                    // Reset the toggle
                    setTimeout(() => {
                        app.extensionManager.setting.set("cryptio.download_client_keys", false);
                    }, 100);
                }
            }
        },
        {
            id: "cryptio.upload_client_keys" as any,
            name: "Upload Client Keys",
            type: "boolean",
            category: ["CryptIO🔒", "Client Keys", "Upload"],
            defaultValue: false,

            tooltip: "Click to upload a client keypair JSON file",
            onChange: (newVal: boolean, oldVal: boolean) => {
                if (newVal === true) {
                    // Create file input and trigger it
                    const input = createFileInput("cryptio-client-upload", handleClientKeyUpload);
                    input.click();
                    // Reset the toggle
                    setTimeout(() => {
                        app.extensionManager.setting.set("cryptio.upload_client_keys", false);
                    }, 100);
                }
            }
        },
        {
            id: "cryptio.download_server_keys" as any,
            name: "Download Server Keys",
            type: "boolean",
            defaultValue: false,
            category: ["CryptIO🔒", "Server Keys", "Download"],
            tooltip: "Click to download server keys as a JSON file",
            onChange: (newVal: boolean, oldVal: boolean) => {
                if (newVal === true) {
                    downloadServerKeys();
                    // Reset the toggle
                    setTimeout(() => {
                        app.extensionManager.setting.set("cryptio.download_server_keys", false);
                    }, 100);
                }
            }
        },
        {
            id: "cryptio.upload_server_keys" as any,
            name: "Upload Server Keys",
            type: "boolean",
            defaultValue: false,
            category: ["CryptIO🔒", "Server Keys", "Upload"],
            tooltip: "Click to upload a server keys JSON file",
            onChange: (newVal: boolean, oldVal: boolean) => {
                if (newVal === true) {
                    // Create file input and trigger it
                    const input = createFileInput("cryptio-server-upload", handleServerKeyUpload);
                    input.click();
                    // Reset the toggle
                    setTimeout(() => {
                        app.extensionManager.setting.set("cryptio.upload_server_keys", false);
                    }, 100);
                }
            }
        },
        {
            id: "cryptio.generate_new_keys" as any,
            name: "Generate New Client Keys",
            type: "boolean",
            defaultValue: false,
            category: ["CryptIO🔒", "Key Management", "Generate"],
            tooltip: "Generate a new client keypair (this will overwrite existing keys)",
            onChange: (newVal: boolean, oldVal: boolean) => {
                if (newVal === true) {
                    generateNewClientKeys();
                    // Reset the toggle
                    setTimeout(() => {
                        app.extensionManager.setting.set("cryptio.generate_new_keys", false);
                    }, 100);
                }
            }
        },
        {
            id: "cryptio.clear_all_keys" as any,
            name: "Clear All Keys",
            type: "boolean",
            defaultValue: false,
            category: ["CryptIO🔒", "Key Management", "Actions"],
            tooltip: "Remove all CryptIO keys from localStorage (cannot be undone)",
            onChange: (newVal: boolean, oldVal: boolean) => {
                if (newVal === true) {
                    clearAllKeys();
                    // Reset the toggle
                    setTimeout(() => {
                        app.extensionManager.setting.set("cryptio.clear_all_keys", false);
                    }, 100);
                }
            }
        }
    ],
    async setup() {
        console.log("CryptIO Settings extension loaded - all settings registered");
    },
});