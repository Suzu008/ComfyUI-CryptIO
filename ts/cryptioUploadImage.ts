//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
//@ts-ignore
import { api as rawApi } from "../../scripts/api.js";
import type {
    ComfyApp,
    ComfyApi,
    ComfyNodeDef,
} from "@comfyorg/comfyui-frontend-types";

const app: ComfyApp = rawApp;
const api: ComfyApi = rawApi;

// 密钥存储键名
const CLIENT_KEYPAIR_STORAGE_KEY = "cryptio_client_keypair";
const SERVER_KEYS_STORAGE_KEY = "cryptio_server_keys";

// 密钥接口
interface KeyPair {
    publicKey: string;
    privateKey: string;
}

interface ServerKeys {
    publicKey: string;
    privateKey: string;
}

// 生成客户端密钥对
async function generateClientKeyPair(): Promise<KeyPair> {
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

// 获取或生成客户端密钥对
async function getClientKeyPair(): Promise<KeyPair> {
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

// 从PEM导入公钥
async function importPublicKeyFromPem(pem: string): Promise<CryptoKey> {
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

// 从PEM导入私钥
async function importPrivateKeyFromPem(pem: string): Promise<CryptoKey> {
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

// 与服务器交换密钥
async function exchangeKeys(): Promise<ServerKeys> {
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
    const serverKeys = JSON.parse(decryptedText);

    // 5. 保存到localStorage
    localStorage.setItem(SERVER_KEYS_STORAGE_KEY, JSON.stringify(serverKeys));

    return serverKeys;
}

// 获取服务端密钥
async function getServerKeys(): Promise<ServerKeys> {
    return await exchangeKeys();
}

// 使用混合加密方案加密文件
async function encryptFile(file: File): Promise<Uint8Array> {
    const serverKeys = await getServerKeys();

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

// 解密文件（用于预览）
async function decryptFile(encryptedData: Uint8Array): Promise<Uint8Array> {
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

// 自定义上传函数
async function uploadEncryptedImage(file: File): Promise<any> {
    console.log("Encrypting and uploading image:", file.name);

    // 加密文件
    const encryptedData = await encryptFile(file);

    // 创建FormData
    const formData = new FormData();
    const encryptedBlob = new Blob([new Uint8Array(encryptedData)], {
        type: "application/octet-stream",
    });
    formData.append("image", encryptedBlob, file.name);

    // 上传到服务器
    const response = await fetch("/cryptio/upload_encrypted", {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }

    return await response.json();
}

// 加载并解密图片用于预览
async function loadEncryptedImageForPreview(filename: string): Promise<string> {
    // 从服务器获取加密数据
    const response = await fetch(
        `/cryptio/view_encrypted?filename=${encodeURIComponent(filename)}`
    );

    if (!response.ok) {
        throw new Error(`Failed to load encrypted image: ${response.statusText}`);
    }

    const data = await response.json();

    // 解密数据
    const encryptedData = Uint8Array.from(atob(data.encrypted_data), (c) =>
        c.charCodeAt(0)
    );
    const decryptedData = await decryptFile(encryptedData);

    // 转换为Blob URL
    const blob = new Blob([new Uint8Array(decryptedData)]);
    return URL.createObjectURL(blob);
}

// 注册扩展
app.registerExtension({
    name: "cryptio.UploadImageCryptIO",
    async setup() {
        // 初始化时交换密钥
        try {
            await exchangeKeys();
            console.log("CryptIO: Keys exchanged successfully");
        } catch (error) {
            console.error("CryptIO: Failed to exchange keys:", error);
        }
    },
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: ComfyApp
    ) {
        if (nodeType.comfyClass === "UploadImageCryptIO") {
            // 添加自定义的upload widget
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (this: any) {
                const r = onNodeCreated?.apply(this, arguments);

                // 添加上传button widget
                const uploadWidget = this.addWidget(
                    "button",
                    "choose file to upload (cryptIO)",
                    "image",
                    () => {
                        const fileInput = document.createElement("input");
                        fileInput.type = "file";
                        fileInput.accept = "image/*";
                        fileInput.style.display = "none";
                        document.body.appendChild(fileInput);

                        fileInput.onchange = async () => {
                            if (fileInput.files && fileInput.files.length > 0) {
                                const file = fileInput.files[0];
                                try {
                                    // 上传加密图片
                                    const result = await uploadEncryptedImage(file);

                                    // 更新image widget的值
                                    const imageWidget = this.widgets.find(
                                        (w: any) => w.name === "image"
                                    );
                                    if (imageWidget) {
                                        imageWidget.value = result.name;
                                    }

                                    // 更新encrypted标志
                                    const encryptedWidget = this.widgets.find(
                                        (w: any) => w.name === "encrypted"
                                    );
                                    if (encryptedWidget) {
                                        encryptedWidget.value = true;
                                    }

                                    // 更新预览
                                    await this.updatePreview(result.name);

                                    app.graph?.setDirtyCanvas(true, false);
                                } catch (error) {
                                    console.error("Upload error:", error);
                                    alert("Failed to upload encrypted image: " + error);
                                }
                            }
                            document.body.removeChild(fileInput);
                        };

                        fileInput.click();
                    }
                );

                // 添加预览更新方法
                this.updatePreview = async function (filename: string) {
                    if (!filename || !filename.endsWith(".encrypted")) {
                        return;
                    }

                    try {
                        const imageUrl = await loadEncryptedImageForPreview(filename);

                        // 更新节点的图片显示
                        const img = new Image();
                        img.onload = () => {
                            this.imgs = [img];
                            app.graph?.setDirtyCanvas(true, false);
                        };
                        img.src = imageUrl;
                    } catch (error) {
                        console.error("Preview error:", error);
                    }
                };

                // 当image值改变时更新预览
                const imageWidget = this.widgets.find((w: any) => w.name === "image");
                if (imageWidget) {
                    const originalCallback = imageWidget.callback;
                    imageWidget.callback = async function (this: any, value: any) {
                        if (originalCallback) {
                            originalCallback.call(this, value);
                        }
                        if (value && value.endsWith(".encrypted")) {
                            await this.node.updatePreview(value);
                        }
                    }.bind({ node: this });
                }

                return r;
            };
        }
    },
});
