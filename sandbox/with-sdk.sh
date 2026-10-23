#!/usr/bin/env bash
# Trusted entrypoint only. Candidate source and stdin are never shell fragments.
set -eo pipefail
export HOME=/tmp
source /opt/cangjie/envsetup.sh
exec "$@"
