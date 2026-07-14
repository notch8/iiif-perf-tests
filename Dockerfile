# Keep in sync with the @playwright/test version in package.json — this image
# ships the matching Chromium build, so a version mismatch here silently runs
# tests against the wrong browser build.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["npx", "playwright", "test"]
