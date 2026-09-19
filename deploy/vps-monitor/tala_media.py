#!/usr/bin/env python3
"""Constrained media validator used by the Tala report intake."""

import io
import json
import os
import resource
import subprocess
import sys
import warnings

MAX_MEDIA = 10_000_000
MAX_PIXELS = 20_000_000
MAX_DIMENSION = 4096
MAX_VIDEO_SECONDS = 60
IMAGE_FORMATS = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
VIDEO_CODECS = {"h264", "hevc", "mpeg4", "vp8", "vp9", "av1"}
AUDIO_CODECS = {"aac", "mp3", "opus", "amr_nb", "amr_wb"}


def _limits():
    for limit, ceiling in ((resource.RLIMIT_CPU, 25), (resource.RLIMIT_FSIZE, 12_000_000),
                           (resource.RLIMIT_NOFILE, 64)):
        soft, hard = resource.getrlimit(limit)
        resource.setrlimit(limit, (min(ceiling, hard) if hard >= 0 else ceiling, hard))
    if sys.platform == "linux" and hasattr(resource, "RLIMIT_AS"):
        soft, hard = resource.getrlimit(resource.RLIMIT_AS)
        resource.setrlimit(resource.RLIMIT_AS,
                           (min(1_500_000_000, hard) if hard >= 0 else 1_500_000_000, hard))


def _image(source, target, mime):
    try:
        from PIL import Image, ImageOps
    except ImportError as error:
        raise RuntimeError("image_processor_unavailable") from error
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        with Image.open(source) as candidate:
            if candidate.format != IMAGE_FORMATS[mime] or getattr(candidate, "n_frames", 1) != 1:
                raise ValueError("invalid_image")
            candidate.verify()
        with Image.open(source) as candidate:
            if candidate.format != IMAGE_FORMATS[mime] or getattr(candidate, "n_frames", 1) != 1:
                raise ValueError("invalid_image")
            width, height = candidate.size
            if (width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION or
                    width * height > MAX_PIXELS):
                raise ValueError("invalid_image_dimensions")
            candidate.load()
            clean = ImageOps.exif_transpose(candidate)
            if mime == "image/jpeg":
                clean = clean.convert("RGB")
                clean.save(target, "JPEG", quality=90, optimize=True)
            elif mime == "image/png":
                clean = clean.convert("RGBA" if "A" in clean.getbands() or "transparency" in candidate.info else "RGB")
                clean.save(target, "PNG", optimize=True)
            else:
                clean = clean.convert("RGBA" if "A" in clean.getbands() else "RGB")
                clean.save(target, "WEBP", quality=90, method=4)


def _command(arguments):
    result = subprocess.run(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=20, check=False,
                            env={"PATH": "/usr/bin:/bin", "LANG": "C"})
    if result.returncode:
        raise ValueError("invalid_video")
    return result.stdout


def _probe(path):
    raw = _command(["/usr/bin/ffprobe", "-protocol_whitelist", "file,pipe", "-v", "error", "-show_entries",
                    "format=format_name,duration,size:stream=codec_type,codec_name,width,height",
                    "-of", "json", path])
    try:
        data = json.loads(raw)
        format_row = data["format"]
        streams = data["streams"]
        duration = float(format_row["duration"])
        size = int(format_row["size"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("invalid_video") from error
    if "mp4" not in format_row.get("format_name", "").split(","):
        raise ValueError("invalid_video_container")
    video = [item for item in streams if item.get("codec_type") == "video"]
    audio = [item for item in streams if item.get("codec_type") == "audio"]
    if len(video) != 1 or len(audio) > 1 or len(video) + len(audio) != len(streams):
        raise ValueError("invalid_video_streams")
    width, height = int(video[0].get("width", 0)), int(video[0].get("height", 0))
    if (video[0].get("codec_name") not in VIDEO_CODECS or
            any(item.get("codec_name") not in AUDIO_CODECS for item in audio) or
            width < 1 or height < 1 or width > MAX_DIMENSION or height > MAX_DIMENSION or
            width * height > MAX_PIXELS or duration <= 0 or duration > MAX_VIDEO_SECONDS or
            size <= 0 or size > MAX_MEDIA):
        raise ValueError("invalid_video_properties")


def _video(source, target):
    _probe(source)
    _command(["/usr/bin/ffmpeg", "-protocol_whitelist", "file,pipe", "-nostdin", "-v", "error",
              "-xerror", "-i", source,
              "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"])
    _command(["/usr/bin/ffmpeg", "-protocol_whitelist", "file,pipe", "-nostdin", "-v", "error",
              "-y", "-i", source,
              "-map", "0:v:0", "-map", "0:a:0?", "-dn", "-sn", "-map_metadata", "-1",
              "-c", "copy", "-movflags", "+faststart", "-f", "mp4", target])
    _probe(target)


def process(source, target, mime):
    if not os.path.isfile(source) or os.path.getsize(source) <= 0 or os.path.getsize(source) > MAX_MEDIA:
        raise ValueError("invalid_media_size")
    if mime in IMAGE_FORMATS:
        _image(source, target, mime)
    elif mime == "video/mp4":
        _video(source, target)
    else:
        raise ValueError("invalid_media_type")
    size = os.path.getsize(target)
    if size <= 0 or size > MAX_MEDIA:
        raise ValueError("processed_media_too_large")
    os.chmod(target, 0o600)
    return size


if __name__ == "__main__":
    if len(sys.argv) != 4:
        raise SystemExit(2)
    _limits()
    try:
        print(json.dumps({"size": process(sys.argv[1], sys.argv[2], sys.argv[3])}))
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
