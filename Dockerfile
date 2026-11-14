# The web application in one image: the built page and the backend that serves it.
#
# It shows saved runs from results/*.json. It never calls a model, so no keys are
# built in and none are needed when it runs. Do not add key settings to the deployment.

# The full Node image, not -slim: it carries the system certificate store, which
# build services that inspect downloads need in order to add their own
# certificate. This stage is thrown away, so its size does not reach the image.
FROM node:22 AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
# If the install fails, print what npm logged: the log is lost when the build stops.
RUN npm ci --no-fund --no-audit || { \
      echo "NODE_EXTRA_CA_CERTS=${NODE_EXTRA_CA_CERTS:-unset}"; \
      grep -hv ' silly ' /root/.npm/_logs/*.log | tail -n 60; \
      exit 1; }
COPY web/ ./
RUN npm run build

FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/
COPY pull_requests.json ./
COPY results/ results/
COPY --from=web /web/dist web/dist/

# Sign-offs and spot-check records are appended to files in results/, so the
# user the server runs as must own that folder.
RUN useradd --system app && chown -R app results
USER app

EXPOSE 8080
CMD ["uvicorn", "reviewer_controls.server:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8080"]
