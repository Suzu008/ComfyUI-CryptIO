//@ts-ignore
import { app as rawApp } from "../../scripts/app.js";
//@ts-ignore
import { api as rawApi } from "../../scripts/api.js";
import type {
    ComfyApp,
    ComfyApi,
    ComfyNodeDef,
} from "@comfyorg/comfyui-frontend-types";

import {
    loadEncryptedVideoFromParams,
    downloadDecryptedVideo
} from "./utils/videoLoader.js";

const app: ComfyApp = rawApp;
const api: ComfyApi = rawApi;

const DEFAULT_VIDEO_SIZE = 256;
const MIN_WIDGET_HEIGHT = 64;

function fitDimensionsToNodeWidth(
    width: number,
    height: number,
    nodeWidth: number
) {
    const aspectRatio = width / height;
    if (!aspectRatio || Number.isNaN(aspectRatio)) {
        return {
            minHeight: DEFAULT_VIDEO_SIZE,
            minWidth: nodeWidth || DEFAULT_VIDEO_SIZE,
        };
    }

    const minWidth = nodeWidth || DEFAULT_VIDEO_SIZE;
    const minHeight = Math.max(minWidth / aspectRatio, MIN_WIDGET_HEIGHT);

    return { minHeight, minWidth };
}

/**
 * Create video preview widget
 */
function createVideoWidget(node: any, videoName: string, videoInfo: any) {
    let minHeight = DEFAULT_VIDEO_SIZE;
    let minWidth = node.size?.[0] || DEFAULT_VIDEO_SIZE;

    const container = document.createElement("div");
    container.classList.add("comfy-img-preview");

    const widget = node.addDOMWidget(
        videoName,
        "video-preview",
        container,
        {
            serialize: false,
            hideOnZoom: false,
        }
    );

    widget.computeLayoutSize = () => ({
        minHeight,
        minWidth,
    });

    widget.updateLayout = (videoWidth: number, videoHeight: number) => {
        const nodeWidth = node.size?.[0] || DEFAULT_VIDEO_SIZE;
        const dimensions = fitDimensionsToNodeWidth(
            videoWidth,
            videoHeight,
            nodeWidth
        );
        minHeight = dimensions.minHeight;
        minWidth = dimensions.minWidth;
    };

    widget.element.addEventListener('pointermove', (event: PointerEvent) => {
        if ((event.buttons & 4) === 4) {
            app.canvas.processMouseMove(event)
        }
    })
    widget.element.addEventListener('pointerdown', (event: PointerEvent) => {
        if ((event.buttons & 4) === 4) {
            app.canvas.processMouseDown(event)
        }
    })


    widget.element.addEventListener('wheel', (event: WheelEvent) => {

        if (event.ctrlKey) {
            event.preventDefault()
            event.stopPropagation()
            return
        }

        event.preventDefault()
        app.canvas.processMouseWheel(event)
    })

    widget.videoInfo = videoInfo;
    widget.value = { hidden: false, videoInfo };

    return widget;
}

/**
 * Update video preview widget with decrypted video
 */
async function updateVideoWidget(widget: any, videoInfo: any) {
    try {
        const videoUrl = await loadEncryptedVideoFromParams(api, videoInfo);

        // Create video element
        const video = document.createElement("video");
        video.controls = true;
        video.loop = true;
        video.muted = true;
        video.autoplay = false;
        video.playsInline = true;

        video.onloadedmetadata = () => {
            widget.updateLayout?.(video.videoWidth, video.videoHeight);
            widget.element.hidden = false;
            widget.element.style.overflow = "hidden";

            // Clear previous content
            widget.element.replaceChildren();

            // Add new video
            widget.element.appendChild(video);
            widget.videoElement = video;
            widget.videoUrl = videoUrl;

            app.rootGraph?.setDirtyCanvas(true, false);
        };

        video.src = videoUrl;

        return videoUrl;
    } catch (error) {
        console.error("Failed to decrypt video for preview:", error);
        throw error;
    }
}

// Register extension
app.registerExtension({
    name: "cryptio.SaveVideoCryptIO",
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: ComfyApp
    ) {
        if (nodeType.comfyClass !== "SaveVideoCryptIO" && nodeType.comfyClass !== "PreviewVideoCryptIO") {
            return;
        }

        // Override default video handling
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = async function (message: any) {
            // Call original handler
            if (onExecuted) {
                onExecuted.apply(this, arguments);
            }

            // Handle encrypted videos (backend returns cryptio_images field with animated flag)
            if (message?.cryptio_images) {
                const autoDownload = this.widgets.find((n: any) => n.name === "auto_download")?.value;

                // Remove existing video preview widgets
                const existingWidgets = this.widgets.filter((w: any) =>
                    w.type === "video-preview"
                );
                for (const widget of existingWidgets) {
                    this.removeWidget(widget);
                }

                // Create new widgets for each video
                for (let i = 0; i < message.cryptio_images.length; i++) {
                    const videoInfo = message.cryptio_images[i];
                    if (videoInfo.filename && videoInfo.filename.endsWith(".encrypted")) {
                        const videoName = `video_${i}`;
                        const widget = createVideoWidget(this, videoName, videoInfo);

                        try {
                            const videoUrl = await updateVideoWidget(widget, videoInfo);

                            // If auto-download is enabled
                            if (autoDownload) {
                                downloadDecryptedVideo(videoUrl, videoInfo.filename);
                                console.log(`Auto-downloaded decrypted video: ${videoInfo.filename.replace(/\.encrypted$/, "")}`);
                            }
                        } catch (error) {
                            console.error("Failed to load video:", error);
                        }
                    }
                }
            }
        };

        // Add context menu support for view/download videos
        const getExtraMenuOptions = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (canvas: any, options: any[]) {
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
        nodeType.prototype.onRemoved = function () {
            // Clean up video widgets
            const videoWidgets = this.widgets?.filter((w: any) =>
                w.type === "video-preview"
            ) || [];

            for (const widget of videoWidgets) {
                if (widget.videoElement) {
                    widget.videoElement.pause();
                    widget.videoElement.src = "";
                }
                if (widget.videoUrl) {
                    URL.revokeObjectURL(widget.videoUrl);
                }
            }

            if (onRemoved) {
                onRemoved.apply(this, arguments);
            }
        };
    },
});
