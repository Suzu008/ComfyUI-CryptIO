/**
 * 上传工具模块
 * 提供文件上传相关功能
 */

import type { ComfyApp } from "@comfyorg/comfyui-frontend-types";
import { encryptFileWithServerKey } from "./cryptoUtils.js";
import { loadEncryptedImageFromFilename } from "./imageLoader.js";

/**
 * 上传加密图片到服务器（使用服务端公钥加密）
 * @param file 要上传的文件
 * @returns 服务器响应
 */
export async function uploadEncryptedImage(file: File): Promise<any> {
    console.log("Encrypting and uploading image:", file.name);

    // 加密文件（使用服务端公钥，如果文件已经加密则直接读取）
    const encryptedData = file?.name?.endsWith(".encrypted")
        ? new Uint8Array(await file.arrayBuffer())
        : await encryptFileWithServerKey(file);

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

/**
 * 处理文件上传到节点的通用方法
 * @param node 节点实例
 * @param file 要上传的文件
 * @param app ComfyUI App实例
 */
export async function handleFileUpload(node: any, file: File, app: ComfyApp) {
    try {
        // 上传加密图片
        const result = await uploadEncryptedImage(file);

        // 更新image widget的值
        const imageWidget = node.widgets.find(
            (w: any) => w.name === "image"
        );
        if (imageWidget) {
            imageWidget.value = result.name;
        }

        // 更新预览
        await node.updatePreview(result.name);

        app.rootGraph?.setDirtyCanvas(true, false);
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
    return async function (this: any, filename: string) {
        if (!filename || !filename.endsWith(".encrypted")) {
            return;
        }

        try {
            const imageUrl = await loadEncryptedImageFromFilename(filename);

            // 更新节点的图片显示
            const img = new Image();
            img.onload = () => {
                this.imgs = [img];
                app.rootGraph?.setDirtyCanvas(true, false);
            };
            img.src = imageUrl;
        } catch (error) {
            console.error("Preview error:", error);
        }
    };
}
