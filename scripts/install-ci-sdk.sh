#!/usr/bin/env bash
# Official SDK, isolated to the CI temporary directory. No system installation.
set -euo pipefail
destination="${1:?Pass an empty SDK destination directory}"
mkdir -p "$destination"
if [ -n "$(ls -A "$destination")" ]; then
  echo 'SDK destination must be empty.' >&2
  exit 1
fi
archive="$destination/sdk.tar.gz"
url='https://cangjie-lang.cn/v1/files/auth/downLoad?nsId=142267&fileName=cangjie-sdk-linux-x64-1.0.5.tar.gz&objectKey=698acf46bd66ae22b62330b0'
curl --fail --location --retry 2 --connect-timeout 20 --max-time 240 "$url" -o "$archive"
printf '%s  %s\n' 'bacad84df8e0281c5395bab4c40e481e3ea6cc712eed5c953903b0d561a14562' "$archive" | sha256sum --check -
tar -xzf "$archive" -C "$destination"
test -f "$destination/cangjie/envsetup.sh"
