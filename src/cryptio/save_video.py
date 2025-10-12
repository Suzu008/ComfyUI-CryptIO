import os
import random
import json
import tempfile
import folder_paths  # pyright: ignore[reportMissingImports]
from .utils import _key_manager
from .utils.crypto_utils import encrypt_data_hybrid
from comfy_api.input import VideoInput
from comfy_api.latest import io, ui


class SaveVideoCryptIO(io.ComfyNode):
    """
    Encrypt and save video files using client public key
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveVideoCryptIO",
            display_name="Save Video CryptIO🔒",
            category="CryptIO",
            description="Encrypt and save videos to the output directory",
            inputs=[
                io.Video.Input("video", tooltip="The video to encrypt and save"),
                io.String.Input("filename_prefix", default="ComfyUI", tooltip="Prefix for the saved encrypted file"),
                io.Boolean.Input("auto_download", default=False, tooltip="Automatically download decrypted video in browser"),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, video: VideoInput, filename_prefix: str = "ComfyUI", auto_download: bool = False) -> io.NodeOutput:
        """
        Encrypt and save video file
        """
        try:
            # Get video dimensions for path generation
            width, height = video.get_dimensions()

            # Generate save path
            full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
                filename_prefix, folder_paths.get_output_directory(), width, height
            )

            # Save video to temporary file first
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4", dir=folder_paths.get_temp_directory())
            temp_file.close()

            # Save video using VideoInput's save_to method
            video.save_to(temp_file.name, format="mp4", codec="auto")

            # Read the saved video file
            with open(temp_file.name, "rb") as f:
                video_data = f.read()

            # Clean up temporary file
            os.unlink(temp_file.name)

            # Encrypt video data using client public key
            if not _key_manager.client_public_key:
                raise ValueError("Client public key not found. Please upload an image first to exchange keys.")

            encrypted_data = encrypt_data_hybrid(video_data, _key_manager.client_public_key)

            # Save encrypted file
            file = f"{filename}_{counter:05}_.mp4.encrypted"
            encrypted_path = os.path.join(full_output_folder, file)

            with open(encrypted_path, "wb") as f:
                f.write(encrypted_data)

            # Save metadata to separate JSON file
            if cls.hidden.prompt is not None or cls.hidden.extra_pnginfo is not None:
                metadata = {}
                if cls.hidden.prompt is not None:
                    metadata["prompt"] = cls.hidden.prompt
                if cls.hidden.extra_pnginfo is not None:
                    metadata.update(cls.hidden.extra_pnginfo)

                metadata_file = f"{filename}_{counter:05}_.json"
                metadata_path = os.path.join(full_output_folder, metadata_file)

                with open(metadata_path, "w", encoding="utf-8") as f:
                    json.dump(metadata, f, indent=2, ensure_ascii=False)

            # Return UI with encrypted video info
            results = [{"filename": file, "subfolder": subfolder, "type": "output", "format": "video/mp4"}]

            return io.NodeOutput(ui={"cryptio_images": results, "animated": [True] * len(results)})

        except Exception as e:
            print(f"Error saving/encrypting video: {e}")
            raise ValueError(f"Failed to save/encrypt video: {e}")


class PreviewVideoCryptIO(io.ComfyNode):
    """
    Encrypt and preview video files using client public key (saved to temp directory)
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="PreviewVideoCryptIO",
            display_name="Preview Video CryptIO🔒",
            category="CryptIO",
            description="Encrypt and preview videos (saved to temp directory)",
            inputs=[
                io.Video.Input("video", tooltip="The video to encrypt and preview"),
                io.Boolean.Input("auto_download", default=False, tooltip="Automatically download decrypted video in browser"),
            ],
            outputs=[],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, video: VideoInput, auto_download: bool = False) -> io.NodeOutput:
        """
        Encrypt and save video file for preview
        """
        try:
            # Get video dimensions for path generation
            width, height = video.get_dimensions()

            # Generate unique prefix for temp files
            random_suffix = "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5))
            filename_prefix = f"ComfyUI_temp_{random_suffix}"

            # Generate save path in temp directory
            full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
                filename_prefix, folder_paths.get_temp_directory(), width, height
            )

            # Save video to temporary file first
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4", dir=folder_paths.get_temp_directory())
            temp_file.close()

            # Save video using VideoInput's save_to method
            video.save_to(temp_file.name, format="mp4", codec="auto")

            # Read the saved video file
            with open(temp_file.name, "rb") as f:
                video_data = f.read()

            # Clean up temporary file
            os.unlink(temp_file.name)

            # Encrypt video data using client public key
            if not _key_manager.client_public_key:
                raise ValueError("Client public key not found. Please upload an image first to exchange keys.")

            encrypted_data = encrypt_data_hybrid(video_data, _key_manager.client_public_key)

            # Save encrypted file
            file = f"{filename}_{counter:05}_.mp4.encrypted"
            encrypted_path = os.path.join(full_output_folder, file)

            with open(encrypted_path, "wb") as f:
                f.write(encrypted_data)

            # Return UI with encrypted video info
            results = [{"filename": file, "subfolder": subfolder, "type": "temp", "format": "video/mp4"}]

            return io.NodeOutput(ui={"cryptio_images": results, "animated": [True] * len(results)})

        except Exception as e:
            print(f"Error previewing/encrypting video: {e}")
            raise ValueError(f"Failed to preview/encrypt video: {e}")
