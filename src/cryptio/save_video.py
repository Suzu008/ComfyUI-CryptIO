import os
import random
from io import BytesIO
import folder_paths  # pyright: ignore[reportMissingImports]
from .utils import _key_manager
import av
import torch
import numpy as np
import math
import json
from fractions import Fraction
from .utils import _key_manager
from .utils.crypto_utils import encrypt_data_hybrid
from comfy_api.input import VideoInput
from comfy_api.latest import io, ui



def _save_to_bytesio_impl(video, buffer, metadata=None):
    """
    Unified method to save video (file or components) to a BytesIO buffer.
    Handles remuxing for files (if compatible) and re-encoding for components.
    """
    # 1. Try Remuxing (if input is a file)
    if hasattr(video, "get_stream_source"):
        try:
            source = video.get_stream_source()
            if isinstance(source, BytesIO):
                source.seek(0)
            
            with av.open(source, mode='r') as input_container:
                # We strictly want MP4 for encryption node compatibility
                # writing to buffer requires explicit format
                with av.open(buffer, mode='w', format='mp4', options={'movflags': 'use_metadata_tags'}) as output_container:
                    # Merge metadata
                    if metadata is None:
                        metadata = {}
                    
                    # Copy input metadata first
                    for key, value in input_container.metadata.items():
                        if key not in metadata:
                            output_container.metadata[key] = value
                    
                    # Apply new metadata
                    for key, value in metadata.items():
                        output_container.metadata[key] = json.dumps(value) if not isinstance(value, str) else value

                    # Map streams
                    stream_map = {}
                    for stream in input_container.streams:
                        # Copy video and audio streams
                        if isinstance(stream, (av.VideoStream, av.AudioStream)):
                            out_stream = output_container.add_stream_from_template(template=stream, opaque=True)
                            stream_map[stream] = out_stream
                    
                    if not stream_map:
                         raise ValueError("No compatible streams found for remuxing")

                    # Copy packets
                    for packet in input_container.demux():
                        if packet.stream in stream_map and packet.dts is not None:
                            packet.stream = stream_map[packet.stream]
                            output_container.mux(packet)
            
            return # Success
        except Exception as e:
            # Fallback to re-encoding
            # print(f"CryptIO: Remux failed ({e}), falling back to re-encoding.")
            buffer.seek(0)
            buffer.truncate()
            pass

    # 2. Re-encoding (VideoFromComponents or fallback)
    components = video.get_components()
    
    with av.open(buffer, mode='w', format='mp4', options={'movflags': 'use_metadata_tags'}) as output:
        if metadata:
            for key, value in metadata.items():
                output.metadata[key] = json.dumps(value) if not isinstance(value, str) else value

        # Video Stream
        frame_rate = components.frame_rate
        if isinstance(frame_rate, (int, float)):
             frame_rate = Fraction(round(frame_rate * 1000), 1000)
             
        if components.images is None or len(components.images) == 0:
             raise ValueError("No video frames to save")

        height, width = components.images.shape[1], components.images.shape[2]
        
        stream = output.add_stream('h264', rate=frame_rate)
        stream.width = width
        stream.height = height
        stream.pix_fmt = 'yuv420p'

        # Audio Stream
        audio_stream = None
        audio_sample_rate = 44100
        if components.audio:
            audio_sample_rate = int(components.audio.get('sample_rate', 44100))
            audio_stream = output.add_stream('aac', rate=audio_sample_rate)

        # Encode Video
        for i, img_tensor in enumerate(components.images):
            img_np = (img_tensor * 255).clamp(0, 255).byte().cpu().numpy()
            frame = av.VideoFrame.from_ndarray(img_np, format='rgb24')
            frame = frame.reformat(format='yuv420p')
            for packet in stream.encode(frame):
                output.mux(packet)
        
        # Flush Video
        for packet in stream.encode(None):
            output.mux(packet)
            
        # Encode Audio
        if audio_stream and components.audio:
            waveform = components.audio['waveform']
            required_samples = math.ceil((audio_sample_rate / frame_rate) * len(components.images))
            if waveform.shape[-1] > required_samples:
                waveform = waveform[..., :required_samples]
            
            flat_audio = waveform.movedim(2, 1).reshape(1, -1).float().cpu().numpy()
            
            frame = av.AudioFrame.from_ndarray(
                flat_audio, 
                format='flt', 
                layout='mono' if waveform.shape[1] == 1 else 'stereo'
            )
            frame.sample_rate = audio_sample_rate
            frame.pts = 0
            
            for packet in audio_stream.encode(frame):
                output.mux(packet)
            
            for packet in audio_stream.encode(None):
                output.mux(packet)


class SaveVideoCryptIO(io.ComfyNode):
    """
    Encrypt and save video files using client public key
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="SaveVideoCryptIO",
            display_name="Save Video 🔒",
            category="CryptIO🔒",
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

            # Prepare workflow metadata
            metadata = None
            if cls.hidden.extra_pnginfo is not None or cls.hidden.prompt is not None:
                metadata = {}
                if cls.hidden.extra_pnginfo is not None:
                    metadata.update(cls.hidden.extra_pnginfo)
                if cls.hidden.prompt is not None:
                    metadata["prompt"] = cls.hidden.prompt

            # Save video to in-memory buffer to avoid writing plaintext to disk
            buffer = BytesIO()
            # Save video to in-memory buffer using unified helper
            buffer = BytesIO()
            _save_to_bytesio_impl(video, buffer, metadata=metadata)
            video_data = buffer.getvalue()
            buffer.close()

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
            display_name="Preview Video 🔒",
            category="CryptIO🔒",
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

            # Prepare workflow metadata
            metadata = None
            if cls.hidden.extra_pnginfo is not None or cls.hidden.prompt is not None:
                metadata = {}
                if cls.hidden.extra_pnginfo is not None:
                    metadata.update(cls.hidden.extra_pnginfo)
                if cls.hidden.prompt is not None:
                    metadata["prompt"] = cls.hidden.prompt

            # Save video to in-memory buffer using unified helper
            buffer = BytesIO()
            # Preview forces mp4/h264 in save_to usually, but our helper does that by default for buffer
            _save_to_bytesio_impl(video, buffer, metadata=metadata)
            video_data = buffer.getvalue()
            buffer.close()

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
