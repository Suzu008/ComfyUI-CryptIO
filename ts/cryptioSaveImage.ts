//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
//@ts-ignore
import { api as rawApi } from "../../scripts/api.js";
import type {
    ComfyApp,
    ComfyApi,
    ComfyNodeDef,
} from "@comfyorg/comfyui-frontend-types";

import { loadEncryptedImageFromParams, downloadDecryptedImage } from "./utils/imageLoader.js";

const app: ComfyApp = rawApp;
const api: ComfyApi = rawApi;

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
                    const autoDownload = this.widgets.find((n: any) => n.name === "auto_download")?.value;

                    for (let i = 0; i < message.cryptio_images.length; i++) {
                        const imageInfo = message.cryptio_images[i];
                        if (imageInfo.filename && imageInfo.filename.endsWith(".encrypted")) {
                            // 异步加载并解密图片
                            loadEncryptedImageFromParams(api, imageInfo)
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
                                            downloadDecryptedImage(imageUrl, imageInfo.filename);
                                            console.log(`Auto-downloaded decrypted image: ${imageInfo.filename.replace(/\.encrypted$/, "")}`);
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
                                    // 获取原始文件名
                                    const filename = this.images?.[i]?.filename || `image_${i}.png.encrypted`;
                                    downloadDecryptedImage(img.src, filename);
                                }
                            }
                        },
                    });
                }
            };
        }
    },
});
