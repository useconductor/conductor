# Deployment Guide

## Quick Start (Docker)

```bash
# Pull the image
docker pull ghcr.io/useconductor/conductor:latest

# Run with API key
docker run -d \
  -p 3000:3000 \
  -v ~/.conductor:/home/node/.conductor \
  -e CONDUCTOR_AI_PROVIDER=claude \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  ghcr.io/useconductor/conductor:latest

# Or use docker-compose
docker-compose up -d
```

---

## Docker Compose (Production)

```yaml
version: '3.8'

services:
  conductor:
    image: ghcr.io/useconductor/conductor:latest
    ports:
      - "3000:3000"
    volumes:
      - conductor_data:/home/node/.conductor
    environment:
      - CONDUCTOR_AI_PROVIDER=claude
      - CONDUCTOR_TRANSPORT=http
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  conductor_data:
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONDUCTOR_AI_PROVIDER` | Yes | `claude`, `openai`, `gemini`, `ollama` |
| `ANTHROPIC_API_KEY` | For Claude | API key |
| `OPENAI_API_KEY` | For OpenAI | API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | For Gemini | API key |
| `CONDUCTOR_TRANSPORT` | No | `stdio` (default) or `http` |
| `CONDUCTOR_PORT` | No | Port for HTTP (default: 3000) |
| `CONDUCTOR_DASHBOARD_TOKEN` | No | Dashboard password |

---

## HTTP Mode (For Remote Clients)

```bash
docker run -d -p 3000:3000 \
  -e CONDUCTOR_TRANSPORT=http \
  -e CONDUCTOR_DASHBOARD_TOKEN=secret123 \
  ghcr.io/useconductor/conductor:latest
```

Then add to Claude Desktop:

```json
{
  "mcpServers": {
    "conductor": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

---

## Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: conductor
spec:
  replicas: 2
  selector:
    matchLabels:
      app: conductor
  template:
    metadata:
      labels:
        app: conductor
    spec:
      containers:
      - name: conductor
        image: ghcr.io/useconductor/conductor:latest
        ports:
        - containerPort: 3000
        env:
        - name: CONDUCTOR_AI_PROVIDER
          value: "claude"
        - name: ANTHROPIC_API_KEY
          valueFrom:
            secretKeyRef:
              name: conductor-secrets
              key: api-key
        volumeMounts:
        - name: data
          mountPath: /home/node/.conductor
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: conductor-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: conductor
spec:
  selector:
    app: conductor
  ports:
  - port: 80
    targetPort: 3000
```

---

## Security

### TLS/SSL

```bash
# Add TLS termination via nginx or cloud provider
# AWS: ALB with ACM certificate
# GCP: Cloud Load Balancer with managed SSL
# Cloudflare: Full SSL/TLS mode
```

### Secrets

```bash
# Use Docker secrets or Kubernetes secrets
echo "api-key" | docker secret create anthropic_key -
```

---

## SSO/OIDC

Enable SSO for enterprise:

```bash
# Set auth provider
conductor config set security.auth.provider oidc
conductor config set security.auth.issuerUrl https://your-domain.auth0.com
conductor config set security.auth.clientId your-client-id
conductor config set security.auth.clientSecret your-client-secret
conductor config set security.auth.audience https://api.conductor
```

Supported providers: Auth0, Okta, Azure AD, Google Workspace

---

## Health & Monitoring

```bash
# Health check
curl http://localhost:3000/health

# Ready check
curl http://localhost:3000/health/ready

# Metrics (Prometheus format)
curl http://localhost:3000/metrics
```

---

## Backup & Restore

```bash
# Backup
tar -czf conductor-backup.tar.gz ~/.conductor/

# Restore
tar -xzf conductor-backup.tar.gz -C ~/
```

Includes: config, database, keychain, audit log, plugins