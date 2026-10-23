# The build script resolves this to an immutable Ubuntu 22.04 RepoDigest.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       bash binutils ca-certificates gcc g++ libc6-dev python3 \
    && rm -rf /var/lib/apt/lists/*

COPY cangjie/ /opt/cangjie/
COPY with-sdk.sh /opt/doctor/with-sdk.sh
# Official SDK archive modes may restrict traversal to the extracting owner.
# The SDK is public, immutable input; allow the sandbox user to read/traverse it
# and execute existing binaries, without granting group/other write access.
RUN chmod -R a+rX,go-w /opt/cangjie \
    && chmod 0755 /opt/doctor/with-sdk.sh \
    && mkdir -p /input /work \
    && chmod 0755 /input /work

LABEL org.cangjie.doctor.sandbox="experimental-v1" \
      org.cangjie.doctor.sdk.version="1.0.5" \
      org.cangjie.doctor.sdk.sha256="bacad84df8e0281c5395bab4c40e481e3ea6cc712eed5c953903b0d561a14562"
WORKDIR /work
USER 65534:65534
# Fail the build if this exact unprivileged user cannot load the SDK. This is an
# image packaging smoke check; runtime isolation is checked separately in CI.
RUN ["/opt/doctor/with-sdk.sh", "cjc", "--version"]
ENTRYPOINT ["/opt/doctor/with-sdk.sh"]
