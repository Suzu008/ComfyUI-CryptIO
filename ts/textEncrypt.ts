//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
//@ts-ignore
import { api as rawApi } from "../../scripts/api.js";
import type {
    ComfyApp,
    ComfyApi,
    ComfyNodeDef,
} from "@comfyorg/comfyui-frontend-types";
import { decryptDataWithServerKey, encryptDataWithServerKey, encryptFileWithServerKey } from "./utils/cryptoUtils.js";
import { base64ToBytes, bytesToBase64 } from "./utils/base64Utils.js";
const app: ComfyApp = rawApp;
const api: ComfyApi = rawApi;

// 使用服务端公钥加密文本
async function encryptText(
    text: string
): Promise<string> {
    try {
        const encrypted = await encryptDataWithServerKey(
            new TextEncoder().encode(text)
        );

        // 转换为Base64
        const encryptedBase64 = bytesToBase64(encrypted);

        // 添加前缀标识这是加密数据
        return "ENCRYPTED:" + encryptedBase64;
    } catch (error) {
        console.error("Encryption error:", error);
        throw error;
    }
}
// 使用服务端私钥解密文本
async function decryptText(
    text: string
): Promise<string> {
    try {
        // 移除前缀
        text = text.replace("ENCRYPTED:", "");
        const decrypted = await decryptDataWithServerKey(
            base64ToBytes(text)
        );

        // 转换为Base64
        const decryptedText = new TextDecoder().decode(decrypted);

        // 添加前缀标识这是加密数据
        return decryptedText;
    } catch (error) {
        console.error("Decryption error:", error);
        throw error;
    }
}

// 注册客户端加密节点
app.registerExtension({
    name: "cryptio.TextEncrypt",
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: ComfyApp
    ) {
        if (nodeType.comfyClass == "TextEncrypt") {
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
    async loadedGraphNode(node, app) {
        if (node.type === "TextEncrypt" && node?.widgets?.[0]) {
            const textWidget = node.widgets[0];
            const text = textWidget.value;
            if (typeof (text) === "string" && text?.startsWith("ENCRYPTED:")) {
                textWidget.value = await decryptText(text);
            }
        }
    },
    async init() {
        console.log("CryptIO client-side encryption initialized");
        const graphToPrompt = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const res = await graphToPrompt.apply(this, args);
            for (const nodeId in res.workflow?.nodes) {
                const node = res.workflow.nodes[nodeId];
                if (node.type === "TextEncrypt") {
                    node.widgets_values[0] = await encryptText(node.widgets_values[0]);
                }
            }
            return res;
        };
    },
});