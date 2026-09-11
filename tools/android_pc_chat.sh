#!/usr/bin/env bash
# One shell preserves the Python/Playwright driver environment across both checks.
set -euo pipefail
bash tools/android_smoke.sh
export MORSETALK_PLAYWRIGHT_MODULE="$(python -c 'import pathlib,playwright; print(pathlib.Path(playwright.__file__).parent / "driver" / "package")')"
export PYTHON="$(command -v python)"
node tools/test_pc_android.cjs
