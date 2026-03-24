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

import { exchangeKeys } from "./utils/cryptoKeys.js";
import { loadEncryptedVideoFromFilename } from "./utils/videoLoader.js";
import { uploadEncryptedFile } from "./utils/uploadUtils.js";
import {
    createVideoWidget,
    renderVideoInWidget,
    clearVideoWidget,
} from "./utils/videoWidgetUtils.js";

const app: CryptIOApp = rawApp as any;
const api: ComfyApi = rawApi;

/**
 * Load encrypted video from filename and render in widget
 */
async function updateVideoWidget(widget: VideoPreviewWidget, filename: string) {
    const videoUrl = await loadEncryptedVideoFromFilename(filename);
    await renderVideoInWidget(widget, videoUrl);
}

/**
 * Handle video file upload to node
 */
async function handleVideoUpload(node: CryptIONode, file: File, app: CryptIOApp) {
    try {
        // Upload encrypted video
        const result = await uploadEncryptedFile(file);

        // Update video widget value
        const videoWidget = node.widgets.find(
            (w: any) => w.name === "video"
        );
        if (videoWidget) {
            videoWidget.value = result.name;
        }

        // Update preview
        const previewWidget = node.widgets.find(
            (w: any) => w.type === "video-preview"
        ) as VideoPreviewWidget;
        if (previewWidget) {
            await updateVideoWidget(previewWidget, result.name);
        }

        if (app.rootGraph) {
            app.rootGraph.setDirtyCanvas(true, false);
        }
    } catch (error) {
        console.error("Upload error:", error);
        alert("Failed to upload encrypted video: " + error);
    }
}

// Register extension
app.registerExtension({
    name: "cryptio.UploadVideoCryptIO",
    async setup() {
        // Exchange keys on initialization (if not already done)
        try {
            await exchangeKeys();
            console.log("CryptIO: Keys exchanged successfully for video upload");
        } catch (error) {
            console.error("CryptIO: Failed to exchange keys:", error);
        }
    },
    async beforeRegisterNodeDef(
        nodeType: any,
        nodeData: ComfyNodeDef,
        app: CryptIOApp
    ) {
        if (nodeType.comfyClass === "UploadVideoCryptIO") {
            // Add custom upload widget
            const onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function (this: CryptIONode) {
                const r = onNodeCreated?.apply(this, arguments);

                // Remove default upload widget
                this.removeWidgetByName("upload");

                // Add upload button widget
                const uploadWidget = this.addWidget(
                    "button",
                    "cryptio-upload-video",
                    "video",
                    () => {
                        const fileInput = document.createElement("input");
                        fileInput.type = "file";
                        fileInput.accept = "video/*,.encrypted";
                        fileInput.style.display = "none";
                        document.body.appendChild(fileInput);

                        fileInput.onchange = async () => {
                            if (fileInput.files && fileInput.files.length > 0) {
                                const file = fileInput.files[0];
                                await handleVideoUpload(this, file, app);
                            }
                            document.body.removeChild(fileInput);
                        };

                        fileInput.click();
                    }
                );
                uploadWidget.label = "choose video to upload";

                // Create video preview widget
                const previewWidget = createVideoWidget(this, { hidden: true });

                // Update preview when video value changes
                const videoWidget = this.widgets.find((w: any) => w.name === "video");
                if (videoWidget) {
                    const originalCallback = videoWidget.callback;

                    // Initial preview update
                    if (videoWidget.value && videoWidget.value.endsWith(".encrypted")) {
                        updateVideoWidget(previewWidget, videoWidget.value).catch(console.error);
                    }

                    videoWidget.callback = async function (this: any, value: any) {
                        if (originalCallback) {
                            originalCallback.call(this, value);
                        }

                        if (value && value.endsWith(".encrypted")) {
                            await updateVideoWidget(previewWidget, value);
                        } else {
                            clearVideoWidget(previewWidget);
                        }
                    };
                }

                // Add Drag and Drop support
                this.onDragOver = function (e: DragEvent) {
                    if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'copy';
                        return true;
                    }
                    return false;
                };

                this.onDragDrop = async function (e: DragEvent) {
                    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
                        return false;
                    }

                    e.preventDefault();
                    e.stopPropagation();

                    const file = e.dataTransfer.files[0];

                    // Check if it's a video file
                    if (!file.type.startsWith('video/') && !file.name.endsWith('.encrypted')) {
                        alert('Please drop a video file');
                        return false;
                    }

                    await handleVideoUpload(this, file, app);
                    return true;
                };

                // Add Paste support
                this.pasteFiles = async function (files: File[]) {
                    for (const file of files) {
                        if (!file.type.startsWith('video/')) {
                            continue;
                        }
                        await handleVideoUpload(this, file, app);
                        return true;
                    }
                };

                return r;
            };

            // Cleanup on node removal
            const onRemoved = nodeType.prototype.onRemoved;
            nodeType.prototype.onRemoved = function (this: CryptIONode) {
                // Clean up video widget
                const videoWidget = this.widgets?.find((w: VideoPreviewWidget) =>
                    w.type === "video-preview"
                );

                if (videoWidget) {
                    clearVideoWidget(videoWidget);
                }

                if (onRemoved) {
                    onRemoved.apply(this, arguments);
                }
            };
        }
    },
});
