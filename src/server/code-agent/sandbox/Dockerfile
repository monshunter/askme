FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

WORKDIR /opt/askme-code-agent

COPY src/server/code-agent/guest-runtime/package.json src/server/code-agent/guest-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && find node_modules -type f \( -name '*.map' -o -name '*.ts' -o -name '*.mts' -o -name '*.cts' \) -delete \
  && npm cache clean --force

COPY src/server/code-agent/guest-runtime/extract.mjs ./extract.mjs
COPY src/server/code-agent/guest-runtime/final-output.mjs ./final-output.mjs
COPY src/server/code-agent/guest-runtime/budget-policy.mjs ./budget-policy.mjs
COPY src/server/code-agent/guest-runtime/citation-ranges.mjs ./citation-ranges.mjs
COPY src/server/code-agent/guest-runtime/wiki-markdown-policy.mjs ./wiki-markdown-policy.mjs
COPY src/server/code-agent/guest-runtime/run.mjs ./run.mjs
COPY src/server/code-agent/skills ./skills

RUN mkdir -p /workspace/input /workspace/source \
  && chown root:root /opt/askme-code-agent /workspace/input /workspace/source \
  && chmod 0755 /opt/askme-code-agent /workspace/input /workspace/source

USER root
CMD ["node", "/opt/askme-code-agent/run.mjs"]
