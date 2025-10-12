/**
 * 加密/解密工具模块
 * 提供文件和数据的加密解密功能
 */

import { getServerKeysWithExchange, getClientKeyPair, importPublicKeyFromPem, importPrivateKeyFromPem, type KeyPair } from "./cryptoKeys.js";

/**
 * 使用混合加密方案加密数据
 * @param data 要加密的数据
 * @param publicKeyPem 用于加密AES密钥的公钥（PEM格式）
 * @returns 加密后的数据
 */
async function encryptData(data: Uint8Array, publicKeyPem: string): Promise<Uint8Array> {
    // 1. 生成随机 AES 密钥
    const aesKey = await window.crypto.subtle.generateKey(
        {
            name: "AES-GCM",
            length: 256,
        },
        true,
        ["encrypt"]
    );

    // 2. 生成随机 IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // 3. 使用 AES 加密文件数据
    const encryptedData = await window.crypto.subtle.encrypt(
        {
            name: "AES-GCM",
            iv: iv,
        },
        aesKey,
        data
    );

    // 4. 导出 AES 密钥
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

    // 5. 使用指定的公钥加密 AES 密钥
    const publicKey = await importPublicKeyFromPem(publicKeyPem);
    const encryptedAesKey = await window.crypto.subtle.encrypt(
        {
            name: "RSA-OAEP",
        },
        publicKey,
        rawAesKey
    );

    // 6. 组合数据
    const encryptedAesKeyArray = new Uint8Array(encryptedAesKey);
    const encryptedDataArray = new Uint8Array(encryptedData);
    const combined = new Uint8Array(
        4 + encryptedAesKeyArray.length + 4 + iv.length + encryptedDataArray.length
    );

    const view = new DataView(combined.buffer);
    view.setUint32(0, encryptedAesKeyArray.length, false);
    combined.set(encryptedAesKeyArray, 4);
    view.setUint32(4 + encryptedAesKeyArray.length, iv.length, false);
    combined.set(iv, 4 + encryptedAesKeyArray.length + 4);
    combined.set(encryptedDataArray, 4 + encryptedAesKeyArray.length + 4 + iv.length);

    return combined;
}

/**
 * 使用混合加密方案加密文件（UploadImage场景，使用服务端公钥）
 * @param file 要加密的文件
 * @returns 加密后的数据
 */
export async function encryptFileWithServerKey(file: File): Promise<Uint8Array> {
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    return await encryptDataWithServerKey(data);
}

export async function encryptDataWithServerKey(data: Uint8Array): Promise<Uint8Array> {
    const serverKeys = await getServerKeysWithExchange();
    return await encryptData(data, serverKeys.publicKey);
}

/**
 * 使用混合加密方案加密文件（支持自定义密钥对）
 * @param file 要加密的文件
 * @param keyPair 密钥对（使用其中的公钥加密）
 * @returns 加密后的数据
 */
export async function encryptFileWithKeyPair(file: File, keyPair: KeyPair): Promise<Uint8Array> {
    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    return await encryptData(data, keyPair.publicKey);
}

/**
 * 解密文件数据（使用指定的私钥）
 * @param encryptedData 加密的数据
 * @param privateKeyPem 用于解密AES密钥的私钥（PEM格式）
 * @returns 解密后的数据
 */
async function decryptData(encryptedData: Uint8Array, privateKeyPem: string): Promise<Uint8Array> {
    // 解析组合数据
    let offset = 0;

    // 1. 读取加密的AES密钥长度
    const view = new DataView(encryptedData.buffer);
    const encryptedAesKeyLength = view.getUint32(offset, false);
    offset += 4;

    // 2. 读取加密的AES密钥
    const encryptedAesKey = encryptedData.slice(
        offset,
        offset + encryptedAesKeyLength
    );
    offset += encryptedAesKeyLength;

    // 3. 读取IV长度
    const ivLength = view.getUint32(offset, false);
    offset += 4;

    // 4. 读取IV
    const iv = encryptedData.slice(offset, offset + ivLength);
    offset += ivLength;

    // 5. 读取加密的数据
    const encrypted = encryptedData.slice(offset);

    // 6. 使用指定的私钥解密AES密钥
    const privateKey = await importPrivateKeyFromPem(privateKeyPem);
    const aesKeyBuffer = await window.crypto.subtle.decrypt(
        {
            name: "RSA-OAEP",
        },
        privateKey,
        encryptedAesKey
    );

    // 7. 导入AES密钥
    const aesKey = await window.crypto.subtle.importKey(
        "raw",
        aesKeyBuffer,
        {
            name: "AES-GCM",
            length: 256,
        },
        false,
        ["decrypt"]
    );

    // 8. 使用AES密钥解密数据
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: "AES-GCM",
            iv: iv,
        },
        aesKey,
        encrypted
    );

    return new Uint8Array(decryptedBuffer);
}

/**
 * 解密文件数据（UploadImage预览场景，使用服务端私钥）
 * @param encryptedData 加密的数据
 * @returns 解密后的数据
 */
export async function decryptDataWithServerKey(encryptedData: Uint8Array): Promise<Uint8Array> {
    const serverKeys = await getServerKeysWithExchange();
    return await decryptData(encryptedData, serverKeys.privateKey);
}

/**
 * 解密文件数据（SaveImage/PreviewImage场景，使用客户端私钥）
 * @param encryptedData 加密的数据
 * @returns 解密后的数据
 */
export async function decryptFileWithClientKey(encryptedData: Uint8Array): Promise<Uint8Array> {
    const clientKeyPair = await getClientKeyPair();
    return await decryptData(encryptedData, clientKeyPair.privateKey);
}

/**
 * 解密文件数据（支持自定义密钥对）
 * @param encryptedData 加密的数据
 * @param keyPair 密钥对（使用其中的私钥解密）
 * @returns 解密后的数据
 */
export async function decryptFileWithKeyPair(encryptedData: Uint8Array, keyPair: KeyPair): Promise<Uint8Array> {
    return await decryptData(encryptedData, keyPair.privateKey);
}
