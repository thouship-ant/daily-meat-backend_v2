#!/bin/sh
# Deploy / update on the server:  ./infra/deploy.sh
# Pulls the latest code, rebuilds, applies database migrations, restarts the API.
set -eu
cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env"
[ -f .env ] || { echo "Missing .env (copy .env.example)"; exit 1; }
git pull --ff-only
$COMPOSE build
$COMPOSE up -d db redis
$COMPOSE run --rm migrate
$COMPOSE up -d --remove-orphans
$COMPOSE ps
docker image prune -f >/dev/null
