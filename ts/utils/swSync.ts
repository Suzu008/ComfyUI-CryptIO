/**
 * SW status sync module — single source of truth for Service Worker
 * registration, key delivery, and consistency verification.
 *
 * Replacements from the old swKeySender.ts:
 *   sendKeysToServiceWorker() → syncSWStatus()
 *   (nothing)                → clearSWKeys()
 */
import { getClientKeyPair, getServerKeysWithExchange } from "./cryptoKeys.js";

let _syncPromise: Promise<void> | null = null;

/* ------------------------------------------------------------------ */
/*  SHA-256 fingerprint                                                */
/* ------------------------------------------------------------------ */
export async function sha256(str: string): Promise<string> {
    const data = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/*  Find / register the CryptIO Service Worker                        */
/* ------------------------------------------------------------------ */
async function ensureSWReady(): Promise<ServiceWorker | null> {
    if (!("serviceWorker" in navigator)) return null;

    const SW_PATH = "/cryptio-sw.js";

    // Check if already registered
    const regs = await navigator.serviceWorker.getRegistrations();
    const existing = regs.find((r) => {
        const script = r.active?.scriptURL || r.waiting?.scriptURL || r.installing?.scriptURL || "";
        return script.endsWith(SW_PATH);
    });

    let registration: ServiceWorkerRegistration;
    if (existing) {
        registration = existing;
    } else {
        registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
        console.log("[CryptIO] SW registered:", registration.active?.scriptURL || registration.installing?.scriptURL);
    }

    await navigator.serviceWorker.ready;

    // Wait for the SW to become the controller
    for (let i = 0; i < 20 && (!navigator.serviceWorker.controller || !navigator.serviceWorker.controller.scriptURL.includes("cryptio")); i++) {
        await new Promise((r) => setTimeout(r, 150));
    }

    const controller = navigator.serviceWorker.controller;
    if (!controller || !controller.scriptURL.includes("cryptio")) {
        console.warn("[CryptIO] SW not controlling page after wait — controllerchange listener will retry");
        return null;
    }

    console.log("[CryptIO] SW controlling:", controller.scriptURL);
    return controller;
}

/* ------------------------------------------------------------------ */
/*  Query SW status via MessageChannel                                 */
/* ------------------------------------------------------------------ */
function querySWStatus(sw: ServiceWorker): Promise<any> {
    return new Promise((resolve, reject) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
            channel.port1.close();
            reject(new Error("SW status query timed out"));
        }, 5000);

        channel.port1.onmessage = (event) => {
            clearTimeout(timeout);
            if (event.data?.type === "cryptio-status") {
                resolve(event.data);
            } else {
                reject(new Error("Unexpected SW response: " + JSON.stringify(event.data)));
            }
        };

        sw.postMessage({ type: "cryptio-sync-status" }, [channel.port2]);
    });
}

/* ------------------------------------------------------------------ */
/*  Send a single key to SW (fire-and-forget)                          */
/* ------------------------------------------------------------------ */
function sendKeyToSW(sw: ServiceWorker, type: string, key: string, fingerprint: string): void {
    sw.postMessage({ type, key, fingerprint });
}

/* ------------------------------------------------------------------ */
/*  syncSWStatus — ensure SW is ready and holds consistent keys        */
/* ------------------------------------------------------------------ */
export async function syncSWStatus(): Promise<void> {
    if (_syncPromise) return _syncPromise;
    _syncPromise = _doSync();
    try {
        await _syncPromise;
    } finally {
        _syncPromise = null;
    }
}

async function _doSync(): Promise<void> {
    const sw = await ensureSWReady();
    if (!sw) {
        console.warn("[CryptIO] sync skipped — SW not available");
        return;
    }

    // Read main-thread keys + fingerprints
    const clientKP = await getClientKeyPair();
    const serverKeys = await getServerKeysWithExchange();
    const expectedClientFp = await sha256(clientKP.privateKey);
    const expectedServerFp = await sha256(serverKeys.privateKey);

    // Query SW current state
    const status = await querySWStatus(sw);
    console.log("[CryptIO] SW status — client:", status.keys.client, "server:", status.keys.server);

    // Push keys that are missing or mismatched
    let updated = false;
    if (!status.keys.client.loaded || status.keys.client.fingerprint !== expectedClientFp) {
        console.log("[CryptIO] pushing client key to SW...");
        sendKeyToSW(sw, "cryptio-set-key", clientKP.privateKey, expectedClientFp);
        updated = true;
    }
    if (!status.keys.server.loaded || status.keys.server.fingerprint !== expectedServerFp) {
        console.log("[CryptIO] pushing server key to SW...");
        sendKeyToSW(sw, "cryptio-set-server-key", serverKeys.privateKey, expectedServerFp);
        updated = true;
    }

    if (updated) {
        // Wait for SW to process keys, then verify
        await new Promise((r) => setTimeout(r, 100));
        const finalStatus = await querySWStatus(sw);
        const clientOk = finalStatus.keys.client.loaded && finalStatus.keys.client.fingerprint === expectedClientFp;
        const serverOk = finalStatus.keys.server.loaded && finalStatus.keys.server.fingerprint === expectedServerFp;
        if (clientOk && serverOk) {
            console.log("[CryptIO] sync verified — keys consistent");
        } else {
            console.warn("[CryptIO] sync verification mismatch — client:", clientOk, "server:", serverOk);
        }
    } else {
        console.log("[CryptIO] sync skipped — keys already consistent");
    }
}

/* ------------------------------------------------------------------ */
/*  clearSWKeys — clear all keys from SW memory + IndexedDB            */
/* ------------------------------------------------------------------ */
export async function clearSWKeys(): Promise<void> {
    const sw = navigator.serviceWorker?.controller;
    if (!sw || !sw.scriptURL.includes("cryptio")) {
        console.warn("[CryptIO] clearSWKeys skipped — no cryptio SW controlling");
        return;
    }

    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timeout = setTimeout(() => {
            channel.port1.close();
            console.warn("[CryptIO] clearSWKeys timed out");
            resolve();
        }, 3000);

        channel.port1.onmessage = () => {
            clearTimeout(timeout);
            console.log("[CryptIO] SW keys cleared");
            resolve();
        };

        sw.postMessage({ type: "cryptio-clear-keys" }, [channel.port2]);
    });
}

/* ------------------------------------------------------------------ */
/*  sendKeysToServiceWorker — backward-compat wrapper                  */
/* ------------------------------------------------------------------ */
export async function sendKeysToServiceWorker(): Promise<void> {
    await syncSWStatus();
}

/* ------------------------------------------------------------------ */
/*  Controller change listener (set once at module load)               */
/* ------------------------------------------------------------------ */
let _listenerSetup = false;
if (!_listenerSetup && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        console.log("[CryptIO] controllerchange — re-syncing status");
        _syncPromise = null;
        syncSWStatus().catch((err) => console.warn("[CryptIO] controllerchange sync failed:", err));
    });
    _listenerSetup = true;
}
