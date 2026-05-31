//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
//@ts-ignore
import { api as rawApi } from "../../scripts/api.js";
import type {
    ComfyApp,
    ComfyApi,
    ComfyNodeDef,
} from "@comfyorg/comfyui-frontend-types";
import type { CryptIONode, VideoPreviewWidget, CryptIOApp } from "./types.js";

import {
    loadEncryptedVideoFromParams,
    downloadDecryptedVideo
} from "./utils/videoLoader.js";
import {
    createVideoWidget,
    renderVideoInWidget,
    clearVideoWidget,
} from "./utils/videoWidgetUtils.js";

const app: CryptIOApp = rawApp as any;
const api: ComfyApi = rawApi;

/**
 * Load encrypted video from params and render in widget
 */
async function updateVideoWidget(widget: VideoPreviewWidget, videoInfo: any): Promise<string> {
    const videoUrl = await loadEncryptedVideoFromParams(api, videoInfo);
    await renderVideoInWidget(widget, videoUrl);
    return videoUrl;
}

// Register extension
app.registerExtension({
    name: "cryptio.SaveVideoCryptIO",
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: CryptIOApp
    ) {
        if (nodeType.comfyClass !== "SaveVideoCryptIO" && nodeType.comfyClass !== "PreviewVideoCryptIO") {
            return;
        }

        // Override default video handling
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = async function (this: CryptIONode, message: any) {
            // Call original handler
            if (onExecuted) {
                onExecuted.apply(this, arguments);
            }

            // Handle encrypted videos (backend returns cryptio_images field with animated flag)
            if (message?.cryptio_images) {
                const autoDownload = this.widgets.find((n: any) => n.name === "auto_download")?.value;

                // Get existing video preview widgets (reuse them to avoid re-mount in VueNodes mode)
                const existingWidgets = this.widgets.filter((w: any) =>
                    w.type === "video-preview"
                );

                // Remove excess widgets if fewer videos than existing widgets
                for (let i = message.cryptio_images.length; i < existingWidgets.length; i++) {
                    clearVideoWidget(existingWidgets[i]);
                    this.removeWidget(existingWidgets[i]);
                }

                // Reuse existing widgets or create new ones as needed
                const updatePromises: Promise<void>[] = [];
                for (let i = 0; i < message.cryptio_images.length; i++) {
                    const videoInfo = message.cryptio_images[i];
                    if (!videoInfo.filename || !videoInfo.filename.endsWith(".encrypted")) continue;

                    let widget = existingWidgets[i];
                    if (widget) {
                        // Clean up previous video content before reusing the widget
                        if (widget.videoElement) {
                            widget.videoElement.pause();
                            widget.videoElement.src = "";
                        }
                        if (widget.videoUrl) {
                            URL.revokeObjectURL(widget.videoUrl);
                        }
                        widget.videoInfo = videoInfo;
                        widget.value = { ...widget.value, videoInfo };
                    } else {
                        widget = createVideoWidget(this, {
                            widgetName: `video_${i}`,
                            videoInfo,
                        });
                    }

                    updatePromises.push(
                        updateVideoWidget(widget, videoInfo)
                            .then((videoUrl) => {
                                if (autoDownload) {
                                    downloadDecryptedVideo(videoUrl, videoInfo.filename);
                                }
                            })
                            .catch((error) => {
                                console.error("Failed to load video:", error);
                            })
                    );
                }
                await Promise.allSettled(updatePromises);
            }
        };

        // Add context menu support for view/download videos
        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (this: CryptIONode, canvas: any, options: any[]) {
            if (getExtraMenuOptions) {
                getExtraMenuOptions.apply(this, arguments);
            }

            // Find video widgets
            const videoWidgets = this.widgets?.filter((w: any) =>
                w.type === "video-preview" && w.videoElement
            ) || [];

            if (videoWidgets.length > 0) {
                options.push({
                    content: "Download Decrypted Videos",
                    callback: async () => {
                        for (const widget of videoWidgets) {
                            if (widget.videoUrl && widget.videoInfo) {
                                downloadDecryptedVideo(widget.videoUrl, widget.videoInfo.filename);
                            }
                        }
                    },
                });
            }
        };

        // Cleanup on node removal
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function (this: CryptIONode) {
            const videoWidgets = this.widgets?.filter((w: VideoPreviewWidget) =>
                w.type === "video-preview"
            ) || [];

            for (const widget of videoWidgets) {
                clearVideoWidget(widget);
            }

            if (onRemoved) {
                onRemoved.apply(this, arguments);
            }
        };
    },
});
