//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
//@ts-ignore
import { api as rawApi } from "../../scripts/api.js";
import type {
    ComfyApp,
    ComfyApi,
    ComfyNodeDef,
} from "@comfyorg/comfyui-frontend-types";
import type { CryptIONode, CryptIOApp } from "./types.js";

import { downloadDecryptedImage } from "./utils/imageLoader.js";
import { syncSWStatus } from "./utils/swSync.js";

const app: CryptIOApp = rawApp as any;
const api: ComfyApi = rawApi;

// ──────────────────────────────────────────────────
//  Node extension
// ──────────────────────────────────────────────────
app.registerExtension({
    name: "cryptio.SaveImageCryptIO",

    async setup() {
        await syncSWStatus();
    },

    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: CryptIOApp
    ) {
        if (nodeType.comfyClass === "SaveImageCryptIO" || nodeType.comfyClass === "PreviewImageCryptIO") {
            // 覆盖默认的图片处理
            const onExecuted = nodeType.prototype.onExecuted;
            nodeType.prototype.onExecuted = function (this: CryptIONode, message: any) {
                // 调用原始处理 (populates this.imgs from message.images — SW解密透明)
                if (onExecuted) {
                    onExecuted.apply(this, arguments);
                }

                // Auto-download: fetch the /view URL directly, SW decrypts transparently
                if (message?.cryptio_images) {
                    const autoDownload = this.widgets.find((n: any) => n.name === "auto_download")?.value;

                    for (let i = 0; i < message.cryptio_images.length; i++) {
                        const imageInfo = message.cryptio_images[i];
                        if (autoDownload && imageInfo.filename && imageInfo.filename.endsWith(".encrypted")) {
                            const params = new URLSearchParams(imageInfo);
                            const url = api.apiURL(`/view?${params}`);
                            fetch(url)
                                .then((r) => r.blob())
                                .then((blob) => {
                                    const downloadUrl = URL.createObjectURL(blob);
                                    downloadDecryptedImage(downloadUrl, imageInfo.filename);
                                    URL.revokeObjectURL(downloadUrl);
                                    console.log(
                                        "[CryptIO] Auto-downloaded:", imageInfo.filename.replace(/\.encrypted$/, "")
                                    );
                                })
                                .catch((err) => console.error("[CryptIO] Auto-download failed:", err));
                        }
                    }
                }
            };

            // 添加右键菜单支持查看/下载图片
            const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
            nodeType.prototype.getExtraMenuOptions = function (this: CryptIONode, canvas: any, options: any[]) {
                if (getExtraMenuOptions) {
                    getExtraMenuOptions.apply(this, arguments);
                }

                if (this.imgs && this.imgs.length > 0) {
                    options.push({
                        content: "下载解密图片",
                        callback: async () => {
                            if (this.imgs) {
                                for (let i = 0; i < this.imgs.length; i++) {
                                    const img = this.imgs[i];
                                    const filename = this.images?.[i]?.filename || `image_${i}.png.encrypted`;
                                    if (img.src) {
                                        fetch(img.src)
                                            .then((r) => r.blob())
                                            .then((blob) => {
                                                const url = URL.createObjectURL(blob);
                                                downloadDecryptedImage(url, filename);
                                                URL.revokeObjectURL(url);
                                            })
                                            .catch((err) => console.error("[CryptIO] Download failed:", err));
                                    }
                                }
                            }
                        },
                    });
                }
            };
        }
    },
});
