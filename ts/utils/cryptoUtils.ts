/**
 * 加密/解密工具模块
 * 提供文件和数据的加密解密功能
 */

import { getServerKeysWithExchange, getServerKeys, importPublicKeyFromPem, importPrivateKeyFromPem } from "./cryptoKeys.js";

/**
 * 使用混合加密方案加密文件，使用服务端公钥加密 AES 密钥
 * @param file 要加密的文件
 * @returns 加密后的数据
 */
export async function encryptFile(file: File): Promise<Uint8Array> {
    const serverKeys = await getServerKeysWithExchange();

    // 读取文件内容
    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

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

    // 5. 使用服务端公钥加密 AES 密钥
    const serverPublicKey = await importPublicKeyFromPem(
        serverKeys.publicKey
    );
    const encryptedAesKey = await window.crypto.subtle.encrypt(
        {
            name: "RSA-OAEP",
        },
        serverPublicKey,
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
 * 解密文件数据，使用服务端私钥解密 AES 密钥
 * @param encryptedData 加密的数据
 * @returns 解密后的数据
 */
export async function decryptFile(encryptedData: Uint8Array): Promise<Uint8Array> {
    const serverKeys = await getServerKeys();

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

    // 6. 使用服务端私钥解密AES密钥
    const serverPrivateKey = await importPrivateKeyFromPem(
        serverKeys.privateKey
    );
    const aesKeyBuffer = await window.crypto.subtle.decrypt(
        {
            name: "RSA-OAEP",
        },
        serverPrivateKey,
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
