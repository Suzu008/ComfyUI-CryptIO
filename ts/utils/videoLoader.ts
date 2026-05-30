/**
 * 视频加载模块
 * 负责从服务器加载并解密视频用于预览
 */

import type { ComfyApi } from "@comfyorg/comfyui-frontend-types";
import { decryptDataWithServerKey, decryptFileWithClientKey } from "./cryptoUtils.js";
import { getMimeTypeFromFilename, downloadDecryptedFile } from "./fileUtils.js";

export interface VideoLoadParams {
    filename: string;
    subfolder?: string;
    type: string;
}

/**
 * 从简单文件名加载加密视频（用于UploadVideo场景，使用服务端私钥解密）
 * @param filename 文件名
 * @returns Blob URL
 */
export async function loadEncryptedVideoFromFilename(filename: string): Promise<string> {
    // 从服务器获取加密数据（二进制格式）
    const response = await fetch(
        `/cryptio/view_encrypted?filename=${encodeURIComponent(filename)}`
    );

    if (!response.ok) {
        throw new Error(`Failed to load encrypted video: ${response.statusText}`);
    }

    // 直接读取二进制数据
    const encryptedArrayBuffer = await response.arrayBuffer();
    const encryptedData = new Uint8Array(encryptedArrayBuffer);

    // 使用服务端私钥解密（UploadVideo场景）
    const decryptedData = await decryptDataWithServerKey(encryptedData);

    // 转换为Blob URL
    const blob = new Blob([decryptedData as BlobPart], {
        type: getMimeTypeFromFilename(filename),
    });
    return URL.createObjectURL(blob);
}

/**
 * 从参数加载加密视频（用于SaveVideo/PreviewVideo场景，使用客户端私钥解密）
 * @param api ComfyUI API实例
 * @param params 视频参数（包含filename, subfolder, type）
 * @returns Blob URL
 */
export async function loadEncryptedVideoFromParams(api: ComfyApi, params: VideoLoadParams): Promise<string> {
    // 构建URL
    const url = api.apiURL(
        `/view?filename=${encodeURIComponent(params.filename)}&type=${params.type}${
            params.subfolder ? `&subfolder=${encodeURIComponent(params.subfolder)}` : ""
        }`
    );

    // 从服务器获取加密数据（二进制格式）
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to load encrypted video: ${response.statusText}`);
    }

    // 直接读取二进制数据
    let decryptedData: Uint8Array;
    const encryptedArrayBuffer = await response.arrayBuffer();
    const encryptedData = new Uint8Array(encryptedArrayBuffer);

    // If the Service Worker already decrypted the response, skip re-decryption
    if (response.headers.get("X-CryptIO-Decrypted") === "1") {
        decryptedData = encryptedData;
    } else {
        // 使用客户端私钥解密（SaveVideo/PreviewVideo场景）
        decryptedData = await decryptFileWithClientKey(encryptedData);
    }

    // 转换为Blob URL
    const blob = new Blob([new Uint8Array(decryptedData)], {
        type: getMimeTypeFromFilename(params.filename),
    });
    return URL.createObjectURL(blob);
}

/** @deprecated Use downloadDecryptedFile from fileUtils.ts instead */
export const downloadDecryptedVideo = downloadDecryptedFile;

