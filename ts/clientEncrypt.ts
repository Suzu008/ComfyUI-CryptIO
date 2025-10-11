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

// 使用公钥加密文本
async function encryptText(
    text: string,
    publicKey?: string
): Promise<string> {
    publicKey ??= await getPublicKey() ?? undefined;
    if (!publicKey) {
        throw new Error(
            "Failed to get public key for encryption"
        );
    }
    try {
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

        // 加密文本
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const encrypted = await window.crypto.subtle.encrypt(
            {
                name: "RSA-OAEP",
            },
            cryptoKey,
            data
        );

        // 转换为Base64
        const encryptedBase64 = btoa(
            String.fromCharCode(...new Uint8Array(encrypted))
        );

        // 添加前缀标识这是加密数据
        return "ENCRYPTED:" + encryptedBase64;
    } catch (error) {
        console.error("Encryption error:", error);
        return text; // 加密失败时返回原文本
    }
}

// 注册客户端加密节点
app.registerExtension({
    name: "cryptio.ClientEncrypt",
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: ComfyApp
    ) {
        if (nodeType.comfyClass == "ClientEncrypt") {
            const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = async function (
                this: any
            ) {
                const me = originalOnNodeCreated?.apply(this);
                if (this?.widgets) {
                    const widgets = this.widgets;

                    const textWidget = widgets[0];
                    const rawWidget = widgets[1];

                    // Override the serialization of the value to resolve dynamic prompts for all widgets supporting it in this node
                    textWidget.serializeValue = async (
                        workflowNode: any,
                        widgetIndex: number
                    ) => {
                        if (rawWidget.value) return textWidget.value;

                        let prompt = "";




                        const encryptedText = await encryptText(
                            textWidget.value
                        );
                        prompt = encryptedText;


                        return prompt;
                    };
                }
                return me;
            };
        }
    },
    async init() {
        console.log("CryptIO client-side encryption initialized");
        const graphToPrompt = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const res = await graphToPrompt.apply(this, args);
            for (const nodeId in res.workflow?.nodes) {
                const node = res.workflow.nodes[nodeId];
                if (node.type === "ClientEncrypt" && node.widgets_values[1] === false) {
                    node.widgets_values[0] = await encryptText(node.widgets_values[0]);
                    node.widgets_values[1] = true;
                }
            }
            return res;
        };
    },
});