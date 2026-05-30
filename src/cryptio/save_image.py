import os
import json
import random
import numpy as np
import torch
from PIL import Image
from PIL.PngImagePlugin import PngInfo
from io import BytesIO

import folder_paths  # pyright: ignore[reportMissingImports]
from comfy_api.latest import io

from .utils import _key_manager
from .utils.crypto_utils import encrypt_data_hybrid


def _encrypt_data(data: bytes) -> bytes:
    if not _key_manager.client_public_key:
        raise ValueError("Client public key not found. Please upload an image first to exchange keys.")
    return encrypt_data_hybrid(data, _key_manager.client_public_key)


def _encode_and_encrypt(image: Image.Image, format: str, quality: int, compress_level: int, prompt=None, extra_pnginfo=None):
    """Encode image to bytes and encrypt."""
    metadata = None
    if format == "PNG" and (prompt is not None or extra_pnginfo is not None):
        metadata = PngInfo()
        if prompt is not None:
            metadata.add_text("prompt", json.dumps(prompt))
        if extra_pnginfo is not None:
            for x in extra_pnginfo:
                metadata.add_text(x, json.dumps(extra_pnginfo[x]))

    file_ext = format.lower()
    format_key = "JPEG" if format == "JPG" else format

    buffer = BytesIO()
    if format == "PNG":
        image.save(buffer, format="PNG", pnginfo=metadata, compress_level=compress_level)
    else:
        image.save(buffer, format=format_key, quality=quality)

    encrypted_data = _encrypt_data(buffer.getvalue())
    return encrypted_data, file_ext


class SaveImageCryptIO(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveImageCryptIO",
            display_name="Save Image 🔒",
            category="CryptIO🔒",
            description="Encrypt and save images to the output directory",
            inputs=[
                io.Image.Input("images", tooltip="The images to encrypt and save"),
                io.String.Input("filename_prefix", default="ComfyUI", tooltip="Prefix for the saved encrypted file"),
                io.Combo.Input("format", options=["PNG", "JPG", "WEBP", "AVIF"], tooltip="The file format in which to save the image"),
                io.Int.Input("quality", default=95, min=1, max=100, step=1, tooltip="Quality setting for the saved image"),
                io.Boolean.Input("auto_download", default=False, tooltip="Automatically download decrypted image in browser"),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, images, filename_prefix="ComfyUI", format="PNG", quality=95, auto_download=False):
        output_dir = folder_paths.get_output_directory()
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, output_dir, images[0].shape[1], images[0].shape[0]
        )

        prompt = cls.hidden.prompt
        extra_pnginfo = cls.hidden.extra_pnginfo

        results = []
        for batch_number, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            encrypted_data, file_ext = _encode_and_encrypt(img, format, quality, 4, prompt, extra_pnginfo)

            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.{file_ext}.encrypted"
            encrypted_path = os.path.join(full_output_folder, file)

            with open(encrypted_path, "wb") as f:
                f.write(encrypted_data)

            results.append({"filename": file, "subfolder": subfolder, "type": "output"})
            counter += 1

        return io.NodeOutput(ui={"images": results, "cryptio_images": results})


class PreviewImageCryptIO(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="PreviewImageCryptIO",
            display_name="Preview Image 🔒",
            category="CryptIO🔒",
            description="Encrypt and preview images (saved to temp directory)",
            inputs=[
                io.Image.Input("images", tooltip="The images to encrypt and preview"),
                io.Combo.Input("format", options=["PNG", "JPG", "WEBP", "AVIF"], tooltip="The file format in which to save the image"),
                io.Int.Input("quality", default=95, min=1, max=100, step=1, tooltip="Quality setting for the saved image"),
                io.Boolean.Input("auto_download", default=False, tooltip="Automatically download decrypted image in browser"),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, images, auto_download=False, format="PNG", quality=95):
        prefix = "_temp_" + "".join(random.choice("abcdefghijklmnopqrstuvwxyz") for _ in range(5))
        output_dir = folder_paths.get_temp_directory()
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            prefix, output_dir, images[0].shape[1], images[0].shape[0]
        )

        prompt = cls.hidden.prompt
        extra_pnginfo = cls.hidden.extra_pnginfo

        results = []
        for batch_number, image in enumerate(images):
            i = 255.0 * image.cpu().numpy()
            img = Image.fromarray(np.clip(i, 0, 255).astype(np.uint8))

            encrypted_data, file_ext = _encode_and_encrypt(img, format, quality, 1, prompt, extra_pnginfo)

            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.{file_ext}.encrypted"
            encrypted_path = os.path.join(full_output_folder, file)

            with open(encrypted_path, "wb") as f:
                f.write(encrypted_data)

            results.append({"filename": file, "subfolder": subfolder, "type": "temp"})
            counter += 1

        return io.NodeOutput(ui={"images": results, "cryptio_images": results})
