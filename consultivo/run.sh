#!/usr/bin/env bash
# Sobe o MVP do Mensura em http://localhost:8100
set -e
cd "$(dirname "$0")"
python3 -m venv .venv 2>/dev/null || true
# shellcheck disable=SC1091
. .venv/bin/activate
pip install -q -r requirements.txt
uvicorn app.main:app --reload --port 8100
