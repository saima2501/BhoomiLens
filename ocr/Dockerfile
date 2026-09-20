# BhoomiLens OCR worker — Lambda container image.
#
# Uses PaddleOCR for its solid Hindi + English support out of the box.
# Base image is the AWS-provided Python 3.12 Lambda runtime, which already
# has the runtime interface client baked in.
#
# We intentionally do NOT include PP-OCRv4 model weights in the image
# layer via `RUN paddleocr ...`; instead the container mounts them from
# /tmp on cold start (~40MB download). Keeps image well under Lambda's
# 10GB limit and speeds up rebuilds.

FROM public.ecr.aws/lambda/python:3.12

# System libraries required by paddleocr / opencv
RUN dnf install -y \
      mesa-libGL \
      libglvnd-glx \
      libSM \
      libXext \
      libXrender \
      shadow-utils \
      poppler-utils \
      libgomp \
    && dnf clean all

# ---- Python deps ----------------------------------------------------------
COPY ocr/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir setuptools -r /tmp/requirements.txt

# ---- App code ------------------------------------------------------------
# Backend shared modules are optional here (OCR does not need them at runtime),
# but we copy the small ones for consistency.
COPY ocr/handler.py ${LAMBDA_TASK_ROOT}/handler.py

# PaddleOCR insists on a HOME to cache downloaded model weights. Lambda's
# only writable location is /tmp.
ENV HOME=/tmp
ENV PADDLE_PDX_CACHE_HOME=/tmp/paddle_cache
ENV PYTHONUNBUFFERED=1

CMD ["handler.handler"]
