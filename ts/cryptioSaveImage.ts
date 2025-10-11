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
const SERVER_KEYS_STORAGE_KEY = "cryptio_server_keys";

// 密钥接口
interface ServerKeys {
    publicKey: string;
    privateKey: string;
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

// 获取服务端密钥
async function getServerKeys(): Promise<ServerKeys> {
    const cached = localStorage.getItem(SERVER_KEYS_STORAGE_KEY);
    if (cached) {
        try {
            return JSON.parse(cached);
        } catch (e) {
            console.error("Failed to parse stored server keys:", e);
        }
    }
    throw new Error("Server keys not found. Please upload an image first to exchange keys.");
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

// 从文件名中提取MIME类型
function getMimeTypeFromFilename(filename: string): string {
    const baseFilename = filename.replace(/\.encrypted$/, '');
    // 提取原始扩展名
    const lastDotIndex = baseFilename.lastIndexOf('.');
    if (lastDotIndex === -1) {
        // 如果没有扩展名，默认返回image/png
        return 'image/png';
    }

    const extension = baseFilename.substring(lastDotIndex + 1).toLowerCase();

    // 扩展名到MIME类型的映射
    const mimeTypes: { [key: string]: string } = {
        // 图片格式
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'tiff': 'image/tiff',
        'tif': 'image/tiff',
    };

    return mimeTypes[extension] || 'image/png'; // 默认返回image/png
}

// 加载并解密图片用于预览
async function loadEncryptedImageForPreview(params: {
    filename: string;
    subfolder?: string;
    type: string;
}): Promise<string> {
    // 构建URL
    const url = api.apiURL(
        `/view?filename=${encodeURIComponent(params.filename)}&type=${params.type}${params.subfolder ? `&subfolder=${encodeURIComponent(params.subfolder)}` : ""
        }`
    );

    // 从服务器获取加密数据（二进制格式）
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to load encrypted image: ${response.statusText}`);
    }

    // 直接读取二进制数据
    const encryptedArrayBuffer = await response.arrayBuffer();
    const encryptedData = new Uint8Array(encryptedArrayBuffer);

    // 解密数据
    const decryptedData = await decryptFile(encryptedData);

    // 转换为Blob URL
    const blob = new Blob([new Uint8Array(decryptedData)], {
        type: getMimeTypeFromFilename(params.filename),
    });
    return URL.createObjectURL(blob);
}

// 注册扩展
app.registerExtension({
    name: "cryptio.SaveImageCryptIO",
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: ComfyApp
    ) {
        if (nodeType.comfyClass === "SaveImageCryptIO" || nodeType.comfyClass === "PreviewImageCryptIO") {
            // 覆盖默认的图片处理
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (message: any) {
                // 调用原始处理
                if (onExecuted) {
                    onExecuted.apply(this, arguments);
                }

                // 处理加密图片
                if (message?.cryptio_images) {
                    const autoDownload = this.widgets.find((n: any) => n.name === "auto_download").value

                    for (let i = 0; i < message.cryptio_images.length; i++) {
                        const imageInfo = message.cryptio_images[i];
                        if (imageInfo.filename && imageInfo.filename.endsWith(".encrypted")) {
                            // 异步加载并解密图片
                            loadEncryptedImageForPreview(imageInfo)
                                .then((imageUrl) => {
                                    // 更新节点的图片显示
                                    const img = new Image();
                                    img.onload = () => {
                                        if (!this.imgs) {
                                            this.imgs = [];
                                        }
                                        this.imgs[i] = img;
                                        app.rootGraph?.setDirtyCanvas(true, false);

                                        // 如果开启了自动下载
                                        if (autoDownload) {
                                            // 创建下载链接
                                            const a = document.createElement("a");
                                            a.href = imageUrl;
                                            // 移除 .encrypted 后缀
                                            const originalFilename = imageInfo.filename.replace(/\.encrypted$/, "");
                                            a.download = originalFilename;
                                            document.body.appendChild(a);
                                            a.click();
                                            document.body.removeChild(a);
                                            console.log(`Auto-downloaded decrypted image: ${originalFilename}`);
                                        }
                                    };
                                    img.src = imageUrl;
                                })
                                .catch((error) => {
                                    console.error("Failed to decrypt image for preview:", error);
                                });
                        }
                    }
                }
            };

            // 添加右键菜单支持查看/下载图片
            const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
            nodeType.prototype.getExtraMenuOptions = function (canvas: any, options: any[]) {
                if (getExtraMenuOptions) {
                    getExtraMenuOptions.apply(this, arguments);
                }

                // 如果节点有图片
                if (this.imgs && this.imgs.length > 0) {
                    options.push({
                        content: "下载解密图片",
                        callback: async () => {
                            for (let i = 0; i < this.imgs.length; i++) {
                                const img = this.imgs[i];
                                if (img && img.src) {
                                    // 创建下载链接
                                    const a = document.createElement("a");
                                    a.href = img.src;
                                    // 移除 .encrypted 后缀
                                    const originalFilename = this.images?.[i]?.filename?.replace(/\.encrypted$/, "") || `image_${i}.png`;
                                    a.download = originalFilename;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                }
                            }
                        },
                    });
                }
            };
        }
    },
});
