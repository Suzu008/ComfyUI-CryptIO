import os
import hashlib
import tempfile
import folder_paths  # pyright: ignore[reportMissingImports]
from .utils import _key_manager
from .utils.crypto_utils import decrypt_data_hybrid
from comfy_api.input import VideoInput
from comfy_api.input_impl import VideoFromFile
from comfy_api.latest import io


class UploadVideoCryptIO(io.ComfyNode):
    """
    Upload and decrypt encrypted video files using server private key
    """

    @classmethod
    def define_schema(cls):
        input_dir = folder_paths.get_input_directory()
        files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        # Support encrypted video files
        encrypted_video_files = [
            f for f in files if f.endswith((
                ".mp4.encrypted", ".avi.encrypted", ".mov.encrypted",
                ".mkv.encrypted", ".webm.encrypted"
            ))
        ]
        all_files = sorted(set(encrypted_video_files))

        return io.Schema(
            node_id="UploadVideoCryptIO",
            display_name="Upload Video CryptIO🔒",
            category="CryptIO",
            description="Upload and decrypt video files encrypted with server public key",
            inputs=[
                io.Combo.Input("video", options=all_files, tooltip="Select an encrypted video file to upload and decrypt"),
            ],
            outputs=[
                io.Video.Output(tooltip="Decrypted video"),
            ],
        )

    @classmethod
    def execute(cls, video: str) -> io.NodeOutput:
        """
        Decrypt and load the uploaded video file
        """
        if not isinstance(video, str) or not video.endswith(".encrypted"):
            raise ValueError("Invalid video input, expected encrypted video file")

        # Read encrypted file
        video_path = folder_paths.get_annotated_filepath(video)

        with open(video_path, "rb") as f:
            encrypted_data = f.read()

        # Decrypt using server private key
        if not _key_manager.server_private_key:
            raise ValueError("Server private key not initialized")

        decrypted_data = decrypt_data_hybrid(encrypted_data, _key_manager.server_private_key)

        # Save decrypted data to temporary file
        # Note: We don't delete the temp file because VideoInput may need it later
        # ComfyUI will clean up temp directory automatically
        temp_file = tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".mp4",
            dir=folder_paths.get_temp_directory()
        )
        temp_file.write(decrypted_data)
        temp_file.close()

        # Create VideoInput from decrypted file
        video_input = VideoFromFile(temp_file.name)

        return io.NodeOutput(video_input)

    @classmethod
    def fingerprint_inputs(cls, video: str):
        """
        Return unique fingerprint for caching
        """
        if isinstance(video, str) and video.endswith(".encrypted"):
            video_path = folder_paths.get_annotated_filepath(video)
            m = hashlib.sha256()
            with open(video_path, "rb") as f:
                m.update(f.read())
            return m.digest().hex()
        return float("NaN")

    @classmethod
    def validate_inputs(cls, video: str):
        """
        Validate input video file exists
        """
        if isinstance(video, str) and video.endswith(".encrypted"):
            if not folder_paths.exists_annotated_filepath(video):
                return f"Invalid encrypted video file: {video}"
            return True

        if not folder_paths.exists_annotated_filepath(video):
            return f"Invalid video file: {video}"

        return True
