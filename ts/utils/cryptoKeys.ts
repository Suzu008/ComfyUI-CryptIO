/**
 * 密钥管理模块
 * 负责客户端和服务端密钥的生成、导入、交换和存储
 */

// 密钥存储键名
export const CLIENT_KEYPAIR_STORAGE_KEY = "cryptio_client_keypair";
export const SERVER_KEYS_STORAGE_KEY = "cryptio_server_keys";

// 密钥接口
export interface KeyPair {
    publicKey: string;
    privateKey: string;
}

export interface ServerKeys {
    publicKey: string;
    privateKey: string;
}

/**
 * 生成客户端RSA密钥对
 */
export async function generateClientKeyPair(): Promise<KeyPair> {
    // 生成RSA密钥对
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"]
    );

    // 导出公钥为PEM格式
    const publicKeyBuffer = await window.crypto.subtle.exportKey(
        "spki",
        keyPair.publicKey
    );
    const publicKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(publicKeyBuffer))
    );
    const publicKeyPem =
        "-----BEGIN PUBLIC KEY-----\n" +
        publicKeyBase64.match(/.{1,64}/g)!.join("\n") +
        "\n-----END PUBLIC KEY-----";

    // 导出私钥为PEM格式
    const privateKeyBuffer = await window.crypto.subtle.exportKey(
        "pkcs8",
        keyPair.privateKey
    );
    const privateKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(privateKeyBuffer))
    );
    const privateKeyPem =
        "-----BEGIN PRIVATE KEY-----\n" +
        privateKeyBase64.match(/.{1,64}/g)!.join("\n") +
        "\n-----END PRIVATE KEY-----";

    return {
        publicKey: publicKeyPem,
        privateKey: privateKeyPem,
    };
}

/**
 * 获取或生成客户端密钥对
 */
export async function getClientKeyPair(): Promise<KeyPair> {
    // 从localStorage获取
    const stored = localStorage.getItem(CLIENT_KEYPAIR_STORAGE_KEY);
    if (stored) {
        try {
            return JSON.parse(stored);
        } catch (e) {
            console.error("Failed to parse stored client keypair:", e);
        }
    }

    // 生成新的密钥对
    console.log("Generating new client keypair...");
    const keyPair = await generateClientKeyPair();

    // 保存到localStorage
    localStorage.setItem(CLIENT_KEYPAIR_STORAGE_KEY, JSON.stringify(keyPair));

    return keyPair;
}

/**
 * 从PEM格式导入公钥
 */
export async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = pem
        .substring(
            pem.indexOf(pemHeader) + pemHeader.length,
            pem.indexOf(pemFooter)
        )
        .replace(/\s/g, "");

    const binaryDer = window.atob(pemContents);
    const binaryDerArray = new Uint8Array(binaryDer.length);
    for (let i = 0; i < binaryDer.length; i++) {
        binaryDerArray[i] = binaryDer.charCodeAt(i);
    }

    return await window.crypto.subtle.importKey(
        "spki",
        binaryDerArray,
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        false,
        ["encrypt"]
    );
}

/**
 * 从PEM格式导入私钥
 */
export async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const pemContents = pem
        .substring(
            pem.indexOf(pemHeader) + pemHeader.length,
            pem.indexOf(pemFooter)
        )
        .replace(/\s/g, "");

    const binaryDer = window.atob(pemContents);
    const binaryDerArray = new Uint8Array(binaryDer.length);
    for (let i = 0; i < binaryDer.length; i++) {
        binaryDerArray[i] = binaryDer.charCodeAt(i);
    }

    return await window.crypto.subtle.importKey(
        "pkcs8",
        binaryDerArray,
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        false,
        ["decrypt"]
    );
}

/**
 * 与服务器交换密钥，使用客户端公钥加密 AES 密钥
 */
export async function exchangeKeys(): Promise<ServerKeys> {
    // 检查缓存
    const cached = localStorage.getItem(SERVER_KEYS_STORAGE_KEY);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            console.error("Failed to parse stored server keys:", e);
        }
    }

    // 获取客户端密钥对
    const clientKeyPair = await getClientKeyPair();

    // 发送客户端公钥到服务器
    const response = await fetch("/cryptio/exchange_keys", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            client_public_key: clientKeyPair.publicKey,
        }),
    });

    if (!response.ok) {
        throw new Error(`Key exchange failed: ${response.statusText}`);
    }

    const data = await response.json();

    // 使用客户端私钥解密服务端密钥
    const clientPrivateKey = await importPrivateKeyFromPem(
        clientKeyPair.privateKey
    );

    // 1. 解密AES密钥
    const encryptedAesKey = Uint8Array.from(
        atob(data.encrypted_aes_key),
        (c) => c.charCodeAt(0)
    );
    const aesKeyBuffer = await window.crypto.subtle.decrypt(
        {
            name: "RSA-OAEP",
        },
        clientPrivateKey,
        encryptedAesKey
    );

    // 2. 导入AES密钥
    const aesKey = await window.crypto.subtle.importKey(
        "raw",
        aesKeyBuffer,
        {
            name: "AES-CBC",
            length: 256,
        },
        false,
        ["decrypt"]
    );

    // 3. 解密服务端密钥数据
    const iv = Uint8Array.from(atob(data.iv), (c) => c.charCodeAt(0));
    const encryptedData = Uint8Array.from(atob(data.encrypted_data), (c) =>
        c.charCodeAt(0)
    );

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: "AES-CBC",
            iv: iv,
        },
        aesKey,
        encryptedData
    );

    // 4. 解析JSON
    const decryptedText = new TextDecoder().decode(decryptedBuffer);
    const rawServerKeys = JSON.parse(decryptedText);
    const serverKeys = {
        publicKey: rawServerKeys.server_public_key,
        privateKey: rawServerKeys.server_private_key,
    };

    // 5. 保存到localStorage
    localStorage.setItem(SERVER_KEYS_STORAGE_KEY, JSON.stringify(serverKeys));

    return serverKeys;
}

/**
 * 获取服务端密钥
 */
export async function getServerKeys(): Promise<ServerKeys> {
    // 先尝试从缓存获取
    const cached = localStorage.getItem(SERVER_KEYS_STORAGE_KEY);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            console.error("Failed to parse stored server keys:", e);
        }
    }

    // 如果缓存不存在，抛出错误（SaveImage场景）
    // 或者尝试交换密钥（UploadImage场景）
    throw new Error("Server keys not found. Please upload an image first to exchange keys.");
}

/**
 * 获取服务端密钥（带自动交换）
 */
export async function getServerKeysWithExchange(): Promise<ServerKeys> {
    return await exchangeKeys();
}
