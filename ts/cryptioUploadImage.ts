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

import { exchangeKeys } from "./utils/cryptoKeys.js";
import { handleFileUpload, createPreviewUpdateFunction } from "./utils/uploadUtils.js";

const app: CryptIOApp = rawApp as any;
const api: ComfyApi = rawApi;

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
        app: CryptIOApp
    ) {
        if (nodeType.comfyClass === "UploadImageCryptIO") {
            // 添加自定义的upload widget
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (this: CryptIONode) {
                const r = onNodeCreated?.apply(this, arguments);

                // 移除默认的upload widget
                this.removeWidgetByName("upload")
                // 添加上传button widget
                const uploadWidget = this.addWidget(
                    "button",
                    "cryptio-upload",
                    "image",
                    () => {
                        const fileInput = document.createElement("input");
                        fileInput.type = "file";
                        fileInput.accept = "image/*,.encrypted";
                        fileInput.style.display = "none";
                        document.body.appendChild(fileInput);

                        fileInput.onchange = async () => {
                            if (fileInput.files && fileInput.files.length > 0) {
                                const file = fileInput.files[0];
                                await handleFileUpload(this, file, app as any);
                            }
                            document.body.removeChild(fileInput);
                        };

                        fileInput.click();
                    }
                );
                uploadWidget.label = "choose file to upload";

                // 添加预览更新方法
                this.updatePreview = createPreviewUpdateFunction(app as any);

                // 当image值改变时更新预览
                const imageWidget = this.widgets.find((w: any) => w.name === "image");
                if (imageWidget) {
                    const originalCallback = imageWidget.callback;
                    if (this.updatePreview) {
                        this.updatePreview(imageWidget.value);
                    }
                    imageWidget.callback = async function (this: any, value: any) {
                        if (originalCallback) {
                            originalCallback.call(this, value);
                        }
                        if (value && value.endsWith(".encrypted")) {
                            const node = this.node as CryptIONode;
                            if (node.updatePreview) {
                                await node.updatePreview(value);
                            }
                        }
                    };
                }

                // 添加Drag and Drop支持
                this.onDragOver = function (e: DragEvent) {
                    // 检查是否有文件
                    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                        // 阻止默认行为以允许drop
                        e.preventDefault();
                        e.stopPropagation();
                        // 设置拖放效果
                        e.dataTransfer.dropEffect = 'copy';
                        return true;
                    }
                    return false;
                };

                this.onDragDrop = async function (e: DragEvent) {
                    // 检查是否有文件
                    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
                        return false;
                    }

                    e.preventDefault();
                    e.stopPropagation();

                    // 获取拖放的文件
                    const file = e.dataTransfer.files[0];

                    // 检查是否为图片文件
                    if (!file.type.startsWith('image/')) {
                        alert('Please drop an image file');
                        return false;
                    }

                    // 上传文件
                    await handleFileUpload(this, file, app as any);

                    return true;
                };

                // 添加Paste支持
                this.pasteFiles = async function (files: File[]) {
                    for (const file of files) {
                        // 查找图片类型
                        if (!file.type.startsWith('image/')) {
                            continue
                        }
                        // 上传文件
                        await handleFileUpload(this, file, app as any);
                        return true;

                    }
                }

                return r;
            };

            // Cleanup blob URLs on node removal
            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function (this: CryptIONode) {
                if (this._cryptioPreviewUrl) {
                    URL.revokeObjectURL(this._cryptioPreviewUrl);
                    this._cryptioPreviewUrl = null;
                }
                if (onRemoved) {
                    onRemoved.apply(this, arguments);
                }
            };
        }
    },
});
