"use strict";

const fs = require("node:fs");
const path = require("node:path");

function generateGitHubActions(projectName, language) {
  const lang = language || "node";
  const testCmd = lang === "python" ? "pytest" : "npm test";
  const buildCmd = lang === "python" ? "pip install -r requirements.txt" : "npm ci";
  const lintCmd = lang === "python" ? "ruff check ." : "npm run lint";

  return `name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: ${buildCmd}
      - run: ${lintCmd}
      - run: ${testCmd}

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: ${lang === "python" ? "python" : "javascript"}
      - uses: github/codeql-action/analyze@v3

  release:
    if: github.ref == 'refs/heads/main'
    needs: [quality, security]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ${buildCmd}
      - run: ${testCmd}
      - uses: softprops/action-gh-release@v1
        with:
          generate_release_notes: true
`;
}

function generateDockerfile(language) {
  if (language === "python") {
    return `FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "main.py"]`;
  }
  if (language === "go") {
    return `FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /app/server .

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/server .
CMD ["./server"]`;
  }
  // Default: Node.js
  return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3000
CMD ["node", "index.js"]`;
}

function generateDockerCompose(services) {
  const svcs = services || [{ name: "app", port: 3000 }];
  let yaml = `version: "3.8"

services:\n`;
  for (const svc of svcs) {
    yaml += `  ${svc.name}:
    build: .
    ports:
      - "${svc.port || 3000}:${svc.port || 3000}"
    environment:
      - NODE_ENV=production
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:${svc.port || 3000}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
`;
  }
  return yaml;
}

function generateKubernetesManifest(appName, port) {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${appName || "app"}
  labels:
    app: ${appName || "app"}
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ${appName || "app"}
  template:
    metadata:
      labels:
        app: ${appName || "app"}
    spec:
      containers:
        - name: ${appName || "app"}
          image: ${appName || "app"}:latest
          ports:
            - containerPort: ${port || 3000}
          livenessProbe:
            httpGet:
              path: /health
              port: ${port || 3000}
            initialDelaySeconds: 10
            periodSeconds: 30
          resources:
            requests:
              memory: "256Mi"
              cpu: "250m"
            limits:
              memory: "512Mi"
              cpu: "500m"
---
apiVersion: v1
kind: Service
metadata:
  name: ${appName || "app"}-service
spec:
  selector:
    app: ${appName || "app"}
  ports:
    - port: 80
      targetPort: ${port || 3000}
  type: ClusterIP
`;
}

function generateTerraform(config) {
  const provider = config?.provider || "aws";
  const region = config?.region || "us-east-1";
  const app = config?.appName || "app";

  if (provider === "aws") {
    return `terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = "${region}"
}

resource "aws_ecs_cluster" "main" {
  name = "${app}-cluster"
}

resource "aws_ecs_service" "main" {
  name            = "${app}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.main.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = aws_subnet.public[*].id
    assign_public_ip = true
  }
}

resource "aws_ecs_task_definition" "main" {
  family                   = "${app}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  container_definitions = jsonencode([
    {
      name  = "${app}"
      image = "${app}:latest"
      portMappings = [{ containerPort = 3000 }]
      environment = [{ name = "NODE_ENV", value = "production" }]
    }
  ])
}
`;
  }
  return `# Terraform configuration for ${app} on ${provider}
# Provider: ${provider}
# Region: ${region}
`;
}

function generateCloudflareWorkersConfig(name) {
  return `name = "${name || "app"}"
main = "src/index.js"
compatibility_date = "2026-01-01"

[observability]
  logs = { enabled = true }
  metrics = { enabled = true }

[env.production]
  vars = { ENVIRONMENT = "production" }

[[d1_databases]]
  binding = "DB"
  database_name = "${name || "app"}-db"
  database_id = ""

[[kv_namespaces]]
  binding = "KV"
  id = ""
`;
}

function generateHelmChart(appName) {
  return `apiVersion: v2
name: ${appName || "app"}
description: A Helm chart for ${appName || "app"}
type: application
version: 0.1.0
appVersion: "1.0.0"
`;
}

module.exports = {
  generateGitHubActions,
  generateDockerfile,
  generateDockerCompose,
  generateKubernetesManifest,
  generateTerraform,
  generateCloudflareWorkersConfig,
  generateHelmChart,
};
