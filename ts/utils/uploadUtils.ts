/**
 * 上传工具模块
 * 提供文件上传相关功能
 */

import type { ComfyApp } from "@comfyorg/comfyui-frontend-types";
import type { CryptIONode } from "../types.js";
import { encryptFileWithServerKey } from "./cryptoUtils.js";
import { syncSWStatus } from "./swSync.js";

/**
 * Upload an encrypted file to the server (encrypted with server public key).
 * Works for both images and videos.
 * @param file File to upload
 * @returns Server response
 */
export async function uploadEncryptedFile(file: File): Promise<any> {
    console.log("Encrypting and uploading file:", file.name);

    // Encrypt file (use server public key, or directly read if already encrypted)
    const encryptedData = file?.name?.endsWith(".encrypted")
        ? new Uint8Array(await file.arrayBuffer())
        : await encryptFileWithServerKey(file);

    // Create FormData
    const formData = new FormData();
    const encryptedBlob = new Blob([encryptedData as BlobPart], {
        type: "application/octet-stream",
    });
    formData.append("image", encryptedBlob, file.name);

    // Upload to server
    const response = await fetch("/cryptio/upload_encrypted", {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`);
    }

    return await response.json();
}

/** @deprecated Use uploadEncryptedFile instead */
export const uploadEncryptedImage = uploadEncryptedFile;

/**
 * 处理文件上传到节点的通用方法
 * @param node 节点实例
 * @param file 要上传的文件
 * @param app ComfyUI App实例
 */
export async function handleFileUpload(node: CryptIONode, file: File, app: ComfyApp) {
    try {
        // 上传加密图片
        const result = await uploadEncryptedImage(file);

        // 更新image widget的值
        const imageWidget = node.widgets.find(
            (w: any) => w.name === "image"
        );
        if (imageWidget) {
            imageWidget.value = result.name;
            imageWidget.callback?.call(imageWidget, result.name);
        }

        // 更新预览
        if (node.updatePreview) {
            await node.updatePreview(result.name);
        }
    } catch (error) {
        console.error("Upload error:", error);
        alert("Failed to upload encrypted image: " + error);
    }
}

/**
 * 创建节点预览更新函数
 * @param app ComfyUI App实例
 * @returns 预览更新函数
 */
export function createPreviewUpdateFunction(app: ComfyApp) {
    return async function (this: CryptIONode, filename: string) {
        if (!filename || !filename.endsWith(".encrypted")) return;

        const url = `/api/view?filename=${encodeURIComponent(filename)}&type=input`;

        const loadImage = (): Promise<HTMLImageElement> =>
            new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error(`Failed to load: ${filename}`));
                i.src = url;
            });

        try {
            this.imgs = [await loadImage()];
            app.rootGraph?.setDirtyCanvas(true, false);
        } catch {
            console.warn("[CryptIO] Preview load failed, syncing SW status and retrying...");
            try {
                await syncSWStatus();
                this.imgs = [await loadImage()];
                app.rootGraph?.setDirtyCanvas(true, false);
            } catch (err) {
                console.error("[CryptIO] Preview failed after sync:", filename, err);
            }
        }
    };
}
