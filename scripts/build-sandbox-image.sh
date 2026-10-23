#!/usr/bin/env bash
# Development image, built only from the reverified official SDK and fixed assets.
set -euo pipefail
umask 077
sdk_directory="${1:?Pass the installed Linux SDK directory}"
receipt_path="${2:?Pass an output JSON receipt path}"
script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
sdk_directory="$(cd -- "$sdk_directory" && pwd -P)"
archive="$(dirname -- "$sdk_directory")/sdk.tar.gz"
sdk_sha256='bacad84df8e0281c5395bab4c40e481e3ea6cc712eed5c953903b0d561a14562'
sdk_url='https://cangjie-lang.cn/v1/files/auth/downLoad?nsId=142267&fileName=cangjie-sdk-linux-x64-1.0.5.tar.gz&objectKey=698acf46bd66ae22b62330b0'
test -f "$sdk_directory/envsetup.sh"
test -f "$archive"
printf '%s  %s\n' "$sdk_sha256" "$archive" | sha256sum --check -

# An inherited Docker context must not send source or build inputs to a remote host.
unset DOCKER_CONTEXT DOCKER_HOST DOCKER_TLS DOCKER_TLS_VERIFY DOCKER_CERT_PATH BUILDX_BUILDER
docker_local() { docker --host unix:///var/run/docker.sock "$@"; }
docker_local info >/dev/null
build_directory="$(mktemp -d -t doctor-sandbox-build.XXXXXXXX)"
cleanup() { rm -rf -- "$build_directory"; }
trap cleanup EXIT
mkdir "$build_directory/context"
tar --no-same-owner --same-permissions -xzf "$archive" -C "$build_directory/context"
test -f "$build_directory/context/cangjie/envsetup.sh"
cp -- "$script_directory/../sandbox/Dockerfile" "$build_directory/context/Dockerfile"
cp -- "$script_directory/../sandbox/with-sdk.sh" "$build_directory/context/with-sdk.sh"

docker_local pull ubuntu:22.04
base_digest="$(docker_local image inspect --format '{{index .RepoDigests 0}}' ubuntu:22.04)"
if [[ ! "$base_digest" =~ ^ubuntu@sha256:[0-9a-f]{64}$ ]]; then
  echo 'Ubuntu image did not resolve to an immutable RepoDigest.' >&2
  exit 1
fi
docker_local build --build-arg "BASE_IMAGE=$base_digest" \
  --iidfile "$build_directory/image-id.txt" \
  --file "$build_directory/context/Dockerfile" "$build_directory/context"
image_id="$(cat "$build_directory/image-id.txt")"
if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo 'Docker build did not produce an immutable image ID.' >&2
  exit 1
fi
test "$(docker_local image inspect --format '{{.Id}}' "$image_id")" = "$image_id"

node --input-type=module - "$receipt_path" "$image_id" "$base_digest" "$sdk_sha256" "$sdk_url" <<'NODE'
import {writeFile, mkdir} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
const [path, image, baseImage, sdkSha256, sdkUrl] = process.argv.slice(2);
const receipt = {
  schemaVersion:1,
  kind:'doctor-development-sandbox-image',
  createdAt:new Date().toISOString(),
  image,
  baseImage,
  sdkVersion:'1.0.5',
  sdkSha256,
  sdkUrl,
  dockerHost:'unix:///var/run/docker.sock',
  context:'Re-extracted verified SDK archive and fixed Dockerfile/entrypoint only.',
  reproducibility:'Development build records the resolved base and image identities; package repository versions are not frozen.'
};
await mkdir(dirname(resolve(path)), {recursive:true});
await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`, {flag:'wx'});
console.log(JSON.stringify(receipt));
NODE
