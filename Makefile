# MyOS — local-first dev harness.
# `make setup` then `make dev` (starts the Python API and the Next app).

PY ?= python3
NPM ?= npm
API_PORT ?= 8000
WEB_PORT ?= 3002
EXPORT ?= myos-export.json

.PHONY: help setup api web dev migrate seed notify test test-api test-web build lint clean up down logs export meta reset

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## install python + node dependencies
	$(PY) -m pip install --root-user-action=ignore -r backend/requirements.txt
	$(NPM) install

api: ## run the FastAPI server on :$(API_PORT)
	cd backend && $(PY) -m uvicorn app.main:app --reload --host 0.0.0.0 --port $(API_PORT)

web: ## run Next.js on :$(WEB_PORT)
	$(NPM) run dev -- -p $(WEB_PORT)

dev: ## run api (background) + web (foreground); logs in /tmp/myos-api.log
	cd backend && nohup $(PY) -m uvicorn app.main:app --reload --host 0.0.0.0 --port $(API_PORT) > /tmp/myos-api.log 2>&1 & \
	$(MAKE) web

migrate: ## apply alembic migrations
	cd backend && $(PY) -m alembic upgrade head

seed: ## idempotent demo data
	cd backend && $(PY) -m app.cli seed

notify: ## recompute derived notifications
	cd backend && $(PY) -m app.cli notify

export: ## dump the whole workspace to a JSON file (EXPORT=myos-export.json to change)
	cd backend && $(PY) -m app.cli export $(EXPORT)

meta: ## print enums + row counts
	cd backend && $(PY) -m app.cli meta

test: test-api test-web ## everything

test-api: ## pytest for the backend
	cd backend && $(PY) -m pytest -q

test-web: ## node:test for the frontend logic
	$(NPM) test

build: ## production build of the Next app
	$(NPM) run build

reset: ## delete the local SQLite database (irreversible)
	rm -f backend/data/myos.db backend/data/myos.db-*

up: ## docker compose (api + web)
	docker compose up --build

down:
	docker compose down

logs:
	tail -n 100 /tmp/myos-api.log
