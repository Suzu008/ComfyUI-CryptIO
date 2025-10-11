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
const PUBLIC_KEY_STORAGE_KEY = "cryptio_public_key";

// 获取公钥
async function getPublicKey(): Promise<string | null> {
    // 先从localStorage获取
    let publicKey = localStorage.getItem(PUBLIC_KEY_STORAGE_KEY);

    // 如果本地没有，则从服务器获取
    if (!publicKey) {
        try {
            const response = await fetch("/cryptio/public_key");
            const data = await response.json();

            if (data.public_key) {
                publicKey = data.public_key;
                if (publicKey == null) {
                    throw new Error("publicKey is null");
                }
                // 保存到localStorage
                localStorage.setItem(PUBLIC_KEY_STORAGE_KEY, publicKey);
            } else {
                console.error("Failed to get public key:", data.error);
                return null;
            }
        } catch (error) {
            console.error("Error fetching public key:", error);
            return null;
        }
    }

    return publicKey;
}

// 导入公钥为 CryptoKey 对象
async function importPublicKey(publicKey?: string): Promise<CryptoKey> {
    publicKey ??= (await getPublicKey()) ?? undefined;
    if (!publicKey) {
        throw new Error("Failed to get public key for encryption");
    }

    // 将PEM格式的公钥转换为CryptoKey对象
    const pemHeader = "-----BEGIN PUBLIC KEY-----";
    const pemFooter = "-----END PUBLIC KEY-----";
    const pemContents = publicKey
        .substring(
            publicKey.indexOf(pemHeader) + pemHeader.length,
            publicKey.indexOf(pemFooter)
        )
        .replace(/\s/g, "");

    // 解码Base64
    const binaryDer = window.atob(pemContents);
    const binaryDerArray = new Uint8Array(binaryDer.length);
    for (let i = 0; i < binaryDer.length; i++) {
        binaryDerArray[i] = binaryDer.charCodeAt(i);
    }

    // 导入公钥
    const cryptoKey = await window.crypto.subtle.importKey(
        "spki",
        binaryDerArray,
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        false,
        ["encrypt"]
    );

    return cryptoKey;
}

// 使用混合加密方案加密文件 (AES加密内容 + RSA加密AES密钥)
async function encryptFile(
    file: File,
    publicKey?: string
): Promise<Uint8Array> {
    try {
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
            ["encrypt", "decrypt"]
        );

        // 2. 生成随机 IV (初始化向量)
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

        // 4. 导出 AES 密钥为原始格式
        const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

        // 5. 使用 RSA 公钥加密 AES 密钥
        const rsaCryptoKey = await importPublicKey(publicKey);
        const encryptedAesKey = await window.crypto.subtle.encrypt(
            {
                name: "RSA-OAEP",
            },
            rsaCryptoKey,
            rawAesKey
        );

        // 6. 组合数据: [加密的AES密钥长度(4字节)] + [加密的AES密钥] + [IV长度(4字节)] + [IV] + [加密的数据]
        const encryptedAesKeyArray = new Uint8Array(encryptedAesKey);
        const encryptedDataArray = new Uint8Array(encryptedData);

        const combined = new Uint8Array(
            4 +
            encryptedAesKeyArray.length +
            4 +
            iv.length +
            encryptedDataArray.length
        );

        // 写入加密的AES密钥长度
        const view = new DataView(combined.buffer);
        view.setUint32(0, encryptedAesKeyArray.length, false); // big-endian

        // 写入加密的AES密钥
        combined.set(encryptedAesKeyArray, 4);

        // 写入IV长度
        view.setUint32(4 + encryptedAesKeyArray.length, iv.length, false);

        // 写入IV
        combined.set(iv, 4 + encryptedAesKeyArray.length + 4);

        // 写入加密的数据
        combined.set(
            encryptedDataArray,
            4 + encryptedAesKeyArray.length + 4 + iv.length
        );

        return combined;
    } catch (error) {
        console.error("File encryption error:", error);
        throw error;
    }
}

// 上传加密的图片文件
async function uploadEncryptedImage(file: File): Promise<any> {
    try {
        console.log("Encrypting and uploading image:", file.name);

        // 加密文件
        const encryptedData = await encryptFile(file);

        // 创建新的 Blob 对象
        const encryptedBlob = new Blob([encryptedData], {
            type: "application/octet-stream",
        });

        // 创建 FormData
        const formData = new FormData();
        formData.append("image", encryptedBlob, file.name);

        // 上传到加密端点
        const response = await fetch("/cryptio/upload_encrypted", {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Upload failed: ${response.statusText}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Encrypted upload failed:", error);
        throw error;
    }
}

// 注册加密图片上传节点
app.registerExtension({
    name: "cryptio.UploadImageCryptIO",
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: ComfyApp
    ) {
        if (nodeType.comfyClass == "UploadImageCryptIO") {
            const originalOnNodeCreated = nodeType.prototype.onNodeCreated;

            nodeType.prototype.onNodeCreated = async function (this: any) {
                const me = originalOnNodeCreated?.apply(this);

                if (this?.widgets) {
                    const widgets = this.widgets;
                    const imageWidget = widgets[0];
                    const encryptedWidget = widgets[1];

                    // 修改 image widget 的上传行为
                    if (imageWidget.type === "combo") {
                        // 保存原始的回调
                        const originalCallback = imageWidget.callback;

                        // 重写回调以标记为已加密
                        imageWidget.callback = function (this: any, ...args: any[]) {
                            const result = originalCallback?.apply(this, args);
                            // 标记为已加密
                            encryptedWidget.value = true;
                            return result;
                        };
                    }
                }

                return me;
            };
        }
    },
    async init() {
        console.log("CryptIO image upload encryption initialized");

        // 拦截图片上传 API
        const originalUploadImage = (api as any).uploadImage;

        (api as any).uploadImage = async function (
            this: any,
            file: File,
            updateNode: any,
            pasted = false
        ) {
            // 检查是否是从 UploadImageCryptIO 节点触发的上传
            // 通过检查节点类型来判断
            let shouldEncrypt = false;

            if (updateNode && updateNode.type === "UploadImageCryptIO") {
                shouldEncrypt = true;
            }

            if (shouldEncrypt) {
                // 使用加密上传
                const result = await uploadEncryptedImage(file);

                // 更新节点的 image widget 值
                if (updateNode && result.name) {
                    const imageWidget = updateNode.widgets?.find(
                        (w: any) => w.name === "image"
                    );
                    if (imageWidget) {
                        imageWidget.value = result.name;
                    }

                    // 标记为已加密
                    const encryptedWidget = updateNode.widgets?.find(
                        (w: any) => w.name === "encrypted"
                    );
                    if (encryptedWidget) {
                        encryptedWidget.value = true;
                    }

                    // 触发节点更新
                    app.graph?.setDirtyCanvas(true);
                }

                return result;
            } else {
                // 使用原始上传方法
                return originalUploadImage.call(this, file, updateNode, pasted);
            }
        };
    },
});
