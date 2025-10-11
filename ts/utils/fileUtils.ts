/**
 * 文件工具模块
 * 提供文件相关的实用函数
 */

/**
 * 从文件名中提取MIME类型
 * @param filename 文件名
 * @returns MIME类型字符串
 */
export function getMimeTypeFromFilename(filename: string): string {
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
        // 视频格式
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mkv': 'video/x-matroska'
    };

    return mimeTypes[extension] || 'image/png'; // 默认返回image/png
}
