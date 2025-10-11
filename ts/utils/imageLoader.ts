/**
 * 图片加载模块
 * 负责从服务器加载并解密图片用于预览
 */

import type { ComfyApi } from "@comfyorg/comfyui-frontend-types";
import { decryptFileWithServerKey, decryptFileWithClientKey } from "./cryptoUtils.js";
import { getMimeTypeFromFilename } from "./fileUtils.js";

export interface ImageLoadParams {
    filename: string;
    subfolder?: string;
    type: string;
}

/**
 * 从简单文件名加载加密图片（用于UploadImage场景，使用服务端私钥解密）
 * @param filename 文件名
 * @returns Blob URL
 */
export async function loadEncryptedImageFromFilename(filename: string): Promise<string> {
    // 从服务器获取加密数据（二进制格式）
    const response = await fetch(
        `/cryptio/view_encrypted?filename=${encodeURIComponent(filename)}`
    );

    if (!response.ok) {
        throw new Error(`Failed to load encrypted image: ${response.statusText}`);
    }

    // 直接读取二进制数据
    const encryptedArrayBuffer = await response.arrayBuffer();
    const encryptedData = new Uint8Array(encryptedArrayBuffer);

    // 使用服务端私钥解密（UploadImage场景）
    const decryptedData = await decryptFileWithServerKey(encryptedData);

    // 转换为Blob URL
    const blob = new Blob([new Uint8Array(decryptedData)], {
        type: getMimeTypeFromFilename(filename),
    });
    return URL.createObjectURL(blob);
}

/**
 * 从参数加载加密图片（用于SaveImage/PreviewImage场景，使用客户端私钥解密）
 * @param api ComfyUI API实例
 * @param params 图片参数（包含filename, subfolder, type）
 * @returns Blob URL
 */
export async function loadEncryptedImageFromParams(api: ComfyApi, params: ImageLoadParams): Promise<string> {
    // 构建URL
    const url = api.apiURL(
        `/view?filename=${encodeURIComponent(params.filename)}&type=${params.type}${
            params.subfolder ? `&subfolder=${encodeURIComponent(params.subfolder)}` : ""
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

    // 使用客户端私钥解密（SaveImage/PreviewImage场景）
    const decryptedData = await decryptFileWithClientKey(encryptedData);

    // 转换为Blob URL
    const blob = new Blob([new Uint8Array(decryptedData)], {
        type: getMimeTypeFromFilename(params.filename),
    });
    return URL.createObjectURL(blob);
}

/**
 * 下载解密后的图片
 * @param blobUrl Blob URL
 * @param filename 原始文件名（带 .encrypted 后缀）
 */
export function downloadDecryptedImage(blobUrl: string, filename: string): void {
    const a = document.createElement("a");
    a.href = blobUrl;
    // 移除 .encrypted 后缀
    const originalFilename = filename.replace(/\.encrypted$/, "");
    a.download = originalFilename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
