// @ts-nocheck
// CryptIO Service Worker — transparently decrypts *.encrypted files
// served via /view?filename=... so both Vue ImagePreview and legacy
// <img> / fetch() get plaintext without any frontend DOM hacks.
//
// Self-contained — no external imports (avoids SW path resolution issues).

const CRYPTO: Crypto = self.crypto as any;
const LOG = (...args: any[]) => console.log("[CryptIO-SW]", ...args);

/* ------------------------------------------------------------------ */
/*  Base64                                                             */
/* ------------------------------------------------------------------ */
function base64ToBytes(base64: string): Uint8Array {
    const binary = self.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/* ------------------------------------------------------------------ */
/*  PEM → CryptoKey (RSA-OAEP private key, pkcs8)                     */
/* ------------------------------------------------------------------ */
async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
    const header = "-----BEGIN PRIVATE KEY-----";
    const footer = "-----END PRIVATE KEY-----";
    const contents = pem
        .substring(pem.indexOf(header) + header.length, pem.indexOf(footer))
        .replace(/\s/g, "");
    const der = base64ToBytes(contents);
    return CRYPTO.subtle.importKey("pkcs8", der, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
}

/* ------------------------------------------------------------------ */
/*  Hybrid decrypt: RSA-OAEP unwrap AES key → AES-GCM decrypt         */
/* ------------------------------------------------------------------ */
async function decryptData(encrypted: Uint8Array, privateKeyPem: string): Promise<Uint8Array> {
    // Wire format: [4B encKeyLen][encKey][4B ivLen][iv][ciphertext]
    const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    let offset = 0;

    const encKeyLen = view.getUint32(offset, false); offset += 4;
    const encKey = encrypted.slice(offset, offset + encKeyLen); offset += encKeyLen;

    const ivLen = view.getUint32(offset, false); offset += 4;
    const iv = encrypted.slice(offset, offset + ivLen); offset += ivLen;

    const ciphertext = encrypted.slice(offset);

    const privateKey = await importPrivateKeyFromPem(privateKeyPem);
    const aesKeyBuf = await CRYPTO.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encKey);
    const aesKey = await CRYPTO.subtle.importKey("raw", aesKeyBuf, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    const plaintext = await CRYPTO.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext);
    return new Uint8Array(plaintext);
}

/* ------------------------------------------------------------------ */
/*  MIME helpers                                                       */
/* ------------------------------------------------------------------ */
function getRealExt(urlOrFilename: string): string {
    // Extract filename from URL query if present
    const url = new URL(urlOrFilename);
    const filename = url.searchParams.get("filename") || url.pathname.split("/").pop() || urlOrFilename;
    const parts = filename.split(".");
    if (parts.length >= 2 && parts[parts.length - 1] === "encrypted") return parts[parts.length - 2];
    return parts[parts.length - 1];
}

function getMimeType(ext: string): string {
    const map: Record<string, string> = {
        png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
        webp: "image/webp", avif: "image/avif", gif: "image/gif",
        svg: "image/svg+xml", bmp: "image/bmp",
        mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
    };
    return map[ext.toLowerCase()] || "application/octet-stream";
}

/* ------------------------------------------------------------------ */
/*  SHA-256 fingerprint                                                */
/* ------------------------------------------------------------------ */
async function sha256(str: string): Promise<string> {
    const data = new TextEncoder().encode(str);
    const hashBuffer = await CRYPTO.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/*  IndexedDB persistence                                              */
/* ------------------------------------------------------------------ */
const DB_NAME = "cryptio-sw-store";
const DB_VERSION = 1;
const STORE_NAME = "keys";

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                req.result.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function loadKeysFromDB(): Promise<{ client: string | null; clientFp: string | null; server: string | null; serverFp: string | null }> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const getClient = store.get("clientKey");
            const getClientFp = store.get("clientFingerprint");
            const getServer = store.get("serverKey");
            const getServerFp = store.get("serverFingerprint");

            const result = { client: null as string | null, clientFp: null as string | null, server: null as string | null, serverFp: null as string | null };
            getClient.onsuccess = () => { if (getClient.result) result.client = getClient.result; };
            getClientFp.onsuccess = () => { if (getClientFp.result) result.clientFp = getClientFp.result; };
            getServer.onsuccess = () => { if (getServer.result) result.server = getServer.result; };
            getServerFp.onsuccess = () => { if (getServerFp.result) result.serverFp = getServerFp.result; };

            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
        });
    } catch {
        return { client: null, clientFp: null, server: null, serverFp: null };
    }
}

async function saveKeyToDB(key: string, keyName: string, fp: string, fpName: string): Promise<void> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.put(key, keyName);
            store.put(fp, fpName);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* ignore — IndexedDB unavailable */ }
}

async function clearKeysFromDB(): Promise<void> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, "readwrite");
            const store = tx.objectStore(STORE_NAME);
            store.clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */
let clientPrivateKeyPem: string | null = null;
let clientFingerprint: string | null = null;
let serverPrivateKeyPem: string | null = null;
let serverFingerprint: string | null = null;

function selectKey(url: string): string | null {
    // type=input  → uploaded images encrypted with SERVER public key → server private key only
    // type=output / type=temp → save/preview encrypted with CLIENT public key → client private key
    if (url.includes("type=input")) return serverPrivateKeyPem;
    return clientPrivateKeyPem;
}

/* ------------------------------------------------------------------ */
/*  Lifecycle                                                          */
/* ------------------------------------------------------------------ */
(self as any).addEventListener("install", (event: ExtendableEvent) => {
    LOG("install — skipping waiting");
    (self as any).skipWaiting();
});

(self as any).addEventListener("activate", (event: ExtendableEvent) => {
    LOG("activate — loading keys from IndexedDB + claiming clients");
    event.waitUntil(
        (async () => {
            try {
                const stored = await loadKeysFromDB();
                if (stored.client) {
                    clientPrivateKeyPem = stored.client;
                    clientFingerprint = stored.clientFp || null;
                }
                if (stored.server) {
                    serverPrivateKeyPem = stored.server;
                    serverFingerprint = stored.serverFp || null;
                }
                LOG("keys loaded from DB — client:", !!clientPrivateKeyPem, "server:", !!serverPrivateKeyPem);
            } catch (err) {
                LOG("loadKeysFromDB failed:", err);
            }

            try {
                await (self as any).clients.claim();
                const clients = await (self as any).clients.matchAll();
                LOG("claim OK, clients in scope:", clients.length);
            } catch (err) {
                LOG("claim ERROR:", err);
            }
        })()
    );
});

/* ------------------------------------------------------------------ */
/*  Messages from main thread                                          */
/* ------------------------------------------------------------------ */
self.addEventListener("message", (event: ExtendableEvent & { data?: any; ports?: MessagePort[] }) => {
    const msg = event.data;

    if (msg?.type === "cryptio-set-key") {
        LOG("set-key received, fingerprint:", msg.fingerprint?.substring(0, 8) + "...");
        clientPrivateKeyPem = msg.key as string;
        clientFingerprint = msg.fingerprint || null;
        saveKeyToDB(msg.key, "clientKey", msg.fingerprint || "", "clientFingerprint").catch(() => {});
        if (event.ports[0]) {
            event.ports[0].postMessage({ type: "cryptio-set-key-ack", ok: true });
        }
    }

    if (msg?.type === "cryptio-set-server-key") {
        LOG("set-server-key received, fingerprint:", msg.fingerprint?.substring(0, 8) + "...");
        serverPrivateKeyPem = msg.key as string;
        serverFingerprint = msg.fingerprint || null;
        saveKeyToDB(msg.key, "serverKey", msg.fingerprint || "", "serverFingerprint").catch(() => {});
        if (event.ports[0]) {
            event.ports[0].postMessage({ type: "cryptio-set-server-key-ack", ok: true });
        }
    }

    if (msg?.type === "cryptio-sync-status") {
        const port = event.ports[0];
        if (port) {
            (async () => {
                const cfp = clientPrivateKeyPem ? (clientFingerprint || await sha256(clientPrivateKeyPem)) : null;
                const sfp = serverPrivateKeyPem ? (serverFingerprint || await sha256(serverPrivateKeyPem)) : null;
                port.postMessage({
                    type: "cryptio-status",
                    ready: true,
                    interceptEnabled: true,
                    keys: {
                        client: { loaded: !!clientPrivateKeyPem, fingerprint: cfp },
                        server: { loaded: !!serverPrivateKeyPem, fingerprint: sfp },
                    },
                    lastError: (self as any).__lastError || null,
                });
            })().catch((err) => {
                port.postMessage({ type: "cryptio-status", ready: false, interceptEnabled: false, keys: { client: { loaded: false, fingerprint: null }, server: { loaded: false, fingerprint: null } }, lastError: String(err) });
            });
        }
    }

    if (msg?.type === "cryptio-clear-keys") {
        LOG("clear-keys received");
        clientPrivateKeyPem = null;
        clientFingerprint = null;
        serverPrivateKeyPem = null;
        serverFingerprint = null;
        clearKeysFromDB().catch(() => {});
        if (event.ports[0]) {
            event.ports[0].postMessage({ type: "cryptio-clear-keys-ack", ok: true });
        }
    }
});

/* ------------------------------------------------------------------ */
/*  Intercept /view?*.encrypted → decrypt transparently                */
/* ------------------------------------------------------------------ */
self.addEventListener("fetch", (event: FetchEvent) => {
    const url = event.request.url;

    if (!url.includes("/view?") && !url.includes("/api/view?")) return;
    if (!url.includes(".encrypted")) return;

    LOG("MATCH:", url);

    event.respondWith(
        (async () => {
            // Fetch original encrypted response (does not re-trigger SW)
            const response = await fetch(event.request);

            const key = selectKey(url);
            if (!key) {
                LOG("no matching key, passing through encrypted response");
                return response;
            }

            try {
                const clone = response.clone();
                const encrypted = new Uint8Array(await clone.arrayBuffer());
                LOG("decrypting", encrypted.length, "bytes...");
                const decrypted = await decryptData(encrypted, key);
                const ext = getRealExt(url);
                const mime = getMimeType(ext);
                LOG("decrypt OK —", decrypted.length, "bytes, mime:", mime);

                return new Response(decrypted, {
                    status: 200,
                    headers: {
                        "Content-Type": mime,
                        "Cache-Control": "no-store",
                        "X-CryptIO-Decrypted": "1",
                    },
                });
            } catch (err) {
                (self as any).__lastError = String(err);
                LOG("decrypt failed:", err);
                return response;
            }
        })()
    );
});

LOG("initialised, waiting for sync...");
