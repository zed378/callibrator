# =============================================================================
# Callibrator — Hospital Device Calibration Platform
#
#   make help          list every target
#   make dev           bring the local stack up
#   make verify        the full pre-push gate
#   make deploy ENV=prod TAG=<sha>
#
# Reference: docs/DEVOPS/11-MAKEFILE-REFERENCE.md
# =============================================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help
.ONESHELL:

# --- configuration -----------------------------------------------------------

ENV        ?= dev
TAG        ?= latest
COMPOSE_DIR := deploy/compose
HELM_DIR    := deploy/helm/callibrator
RELEASE    ?= callibrator
NAMESPACE  ?= callibrator

BACKEND_IMAGE  ?= callibrator/backend
FRONTEND_IMAGE ?= callibrator/frontend

# Overlay selection. The base compose file is not deployable on its own — it
# has no port publishing and no environment-specific settings.
COMPOSE_FILES := -f $(COMPOSE_DIR)/docker-compose.yml
ifeq ($(ENV),dev)
COMPOSE_FILES += -f $(COMPOSE_DIR)/docker-compose.dev.yml
else ifeq ($(ENV),staging)
COMPOSE_FILES += -f $(COMPOSE_DIR)/docker-compose.staging.yml
else ifeq ($(ENV),prod)
COMPOSE_FILES += -f $(COMPOSE_DIR)/docker-compose.prod.yml
else
$(error ENV must be one of: dev, staging, prod  (got "$(ENV)"))
endif

DC := IMAGE_TAG=$(TAG) docker compose --env-file $(COMPOSE_DIR)/.env $(COMPOSE_FILES)

C_BOLD := \033[1m
C_DIM  := \033[2m
C_WARN := \033[33m
C_ERR  := \033[31m
C_OK   := \033[32m
C_OFF  := \033[0m

# =============================================================================
# HELP
# =============================================================================

.PHONY: help
help: ## Show this help
	@echo ""
	@echo -e "$(C_BOLD)Callibrator$(C_OFF)  —  ENV=$(ENV)  TAG=$(TAG)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} \
		/^# ==== / { next } \
		/^[a-zA-Z0-9_-]+:.*?## / { printf "  $(C_BOLD)%-22s$(C_OFF) %s\n", $$1, $$2 } \
		/^## / { printf "\n$(C_DIM)%s$(C_OFF)\n", substr($$0, 4) }' $(MAKEFILE_LIST)
	@echo ""
	@echo -e "$(C_DIM)  ENV=dev|staging|prod   TAG=<image tag>$(C_OFF)"
	@echo ""

# =============================================================================
## Setup
# =============================================================================

.PHONY: env
env: ## Create deploy/compose/.env from the example
	@if [ -f $(COMPOSE_DIR)/.env ]; then
		echo -e "$(C_WARN)$(COMPOSE_DIR)/.env already exists — not overwriting.$(C_OFF)"
	else
		cp $(COMPOSE_DIR)/.env.example $(COMPOSE_DIR)/.env
		echo -e "$(C_OK)Created $(COMPOSE_DIR)/.env$(C_OFF)"
		echo ""
		echo "Now generate the three REQUIRED secrets — the application exits without them:"
		echo "  make secrets"
	fi

.PHONY: secrets
secrets: ## Generate the three required secrets
	@echo ""
	@echo -e "$(C_BOLD)Paste these into $(COMPOSE_DIR)/.env$(C_OFF)"
	@echo ""
	@echo "CERT_SIGNING_SECRET=$$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
	@echo "ENCRYPT_KEY=$$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
	@echo "ATTACHMENT_URL_SECRET=$$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
	@echo "JWT_ACCESS_SECRET=$$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
	@echo "JWT_REFRESH_SECRET=$$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
	@echo ""
	@echo -e "$(C_WARN)BACK UP CERT_SIGNING_SECRET AND ENCRYPT_KEY SEPARATELY FROM THE DATABASE.$(C_OFF)"
	@echo -e "$(C_DIM)A restore that recovers the data and loses them produces a system that starts$(C_OFF)"
	@echo -e "$(C_DIM)cleanly and is permanently broken: every issued certificate fails public$(C_OFF)"
	@echo -e "$(C_DIM)verification, and every wrapped credential is undecryptable. Neither is$(C_OFF)"
	@echo -e "$(C_DIM)practically rotatable. See docs/SECURITY/07.$(C_OFF)"
	@echo ""

.PHONY: install
install: ## Install workspace dependencies
	pnpm install

# =============================================================================
## Development
# =============================================================================

.PHONY: dev
dev: ## Bring up the local stack (ENV=dev) and follow the logs
	$(MAKE) up ENV=dev
	$(MAKE) logs ENV=dev

.PHONY: up
up: check-env ## Start the stack
	$(DC) up -d
	@echo ""
	@echo -e "$(C_OK)Stack up (ENV=$(ENV)).$(C_OFF)  Waiting for the backend to be healthy…"
	@$(MAKE) --no-print-directory wait-healthy

.PHONY: down
down: ## Stop the stack (volumes preserved)
	$(DC) down

.PHONY: destroy
destroy: ## Stop the stack AND DELETE ALL DATA
	@echo -e "$(C_ERR)This deletes deploy/compose/volumes — the database, uploads, backups and"
	@echo -e "Redis (including in-flight worker idempotency claims).$(C_OFF)"
	@read -p "Type the environment name to confirm [$(ENV)]: " c; [ "$$c" = "$(ENV)" ] || { echo "Aborted."; exit 1; }
	$(DC) down -v
	rm -rf $(COMPOSE_DIR)/volumes

.PHONY: restart
restart: ## Restart the application containers
	$(DC) restart backend frontend

.PHONY: logs
logs: ## Follow logs (SERVICE=backend to narrow)
	$(DC) logs -f --tail=200 $(SERVICE)

.PHONY: ps
ps: ## Show container status
	$(DC) ps

.PHONY: shell
shell: ## Shell into a container (SERVICE=backend)
	$(DC) exec $(or $(SERVICE),backend) sh

.PHONY: psql
psql: ## Open psql against the running database
	$(DC) exec postgres psql -U $$(grep '^DB_USER=' $(COMPOSE_DIR)/.env | cut -d= -f2) -d $$(grep '^DB_NAME=' $(COMPOSE_DIR)/.env | cut -d= -f2)

.PHONY: wait-healthy
wait-healthy: ## Block until the backend reports healthy
	@for i in $$(seq 1 60); do
		s=$$($(DC) ps --format json backend 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || true)
		if [ "$$s" = "healthy" ]; then echo -e "$(C_OK)backend healthy$(C_OFF)"; exit 0; fi
		sleep 2
	done
	@echo -e "$(C_ERR)backend did not become healthy.$(C_OFF)"
	@echo -e "$(C_DIM)/health calls db.authenticate() and returns 503 when the database is$(C_OFF)"
	@echo -e "$(C_DIM)unreachable — check the database before the application.$(C_OFF)"
	@$(DC) logs --tail=50 backend
	@exit 1

# =============================================================================
## Database
# =============================================================================

.PHONY: migrate
migrate: ## Run pending migrations
	$(DC) exec backend ./backend --migrate up || cd backend && npm run migrate
	@echo ""
	@echo -e "$(C_WARN)Now VERIFY THE COLUMNS.$(C_OFF)"
	@echo -e "$(C_DIM)A migration wrapped in a blanket try/catch is recorded as applied while doing$(C_OFF)"
	@echo -e "$(C_DIM)nothing. The migration log is not evidence — run: make migrate-verify$(C_OFF)"

.PHONY: migrate-status
migrate-status: ## Show pending migrations
	cd backend && npm run migrate:status

.PHONY: migrate-undo
migrate-undo: ## Roll back the last migration
	cd backend && npm run migrate:undo

.PHONY: migrate-verify
migrate-verify: ## Inspect the real schema (the migration log is not evidence)
	@echo "Columns actually present, per table:"
	$(DC) exec postgres psql -U $$(grep '^DB_USER=' $(COMPOSE_DIR)/.env | cut -d= -f2) \
		-d $$(grep '^DB_NAME=' $(COMPOSE_DIR)/.env | cut -d= -f2) \
		-c "SELECT table_name, count(*) AS columns FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name ORDER BY table_name;"

.PHONY: seed-demo
seed-demo: ## Seed demo data (dev only — ~80 rows, idempotent)
	@if [ "$(ENV)" != "dev" ]; then
		echo -e "$(C_ERR)Refusing: a demo seeder against real data is a data-integrity incident.$(C_OFF)"
		exit 1
	fi
	cd backend && node src/scripts/seedDemo.js

.PHONY: backup
backup: ## Dump the database to ./backups
	@mkdir -p backups
	$(DC) exec -T postgres pg_dump -Fc -U $$(grep '^DB_USER=' $(COMPOSE_DIR)/.env | cut -d= -f2) \
		-d $$(grep '^DB_NAME=' $(COMPOSE_DIR)/.env | cut -d= -f2) > backups/db-$$(date +%F-%H%M).dump
	@echo -e "$(C_OK)Dump written.$(C_OFF)"
	@echo -e "$(C_WARN)A database dump is not a backup on its own.$(C_OFF)"
	@echo -e "$(C_DIM)Back up CERT_SIGNING_SECRET and ENCRYPT_KEY separately, and the object store$(C_OFF)"
	@echo -e "$(C_DIM)too. See docs/DEVOPS/04-DATABASE-BACKUP.md.$(C_OFF)"

# =============================================================================
## Quality gates
# =============================================================================

.PHONY: lint
lint: ## Lint both workspaces
	pnpm lint

.PHONY: typecheck
typecheck: ## Type-check (frontend only — the backend is JavaScript, ADR-030)
	pnpm typecheck

.PHONY: test
test: ## Unit and integration tests
	pnpm test

.PHONY: test-e2e
test-e2e: ## 51 live E2E specs against a RUNNING server
	@echo -e "$(C_WARN)Two rules for this suite:$(C_OFF)"
	@echo -e "$(C_DIM)  1. Never suspend the default tenant — it suspends the super-admin living in$(C_OFF)"
	@echo -e "$(C_DIM)     it and 403s every later request. Create a disposable tenant.$(C_OFF)"
	@echo -e "$(C_DIM)  2. Give the rate limiter room. Repeated runs have exhausted the budget and$(C_OFF)"
	@echo -e "$(C_DIM)     produced failures unrelated to the code under test.$(C_OFF)"
	@echo ""
	cd backend && npm run test:e2e

.PHONY: test-browser
test-browser: ## Playwright browser suite
	@echo -e "$(C_DIM)Flakes here have been self-inflicted: editing a backend file triggers nodemon,$(C_OFF)"
	@echo -e "$(C_DIM)which restarts mid-test and produces ECONNRESET. Confirm nothing is$(C_OFF)"
	@echo -e "$(C_DIM)recompiling before chasing one.$(C_OFF)"
	npx playwright test

.PHONY: build
build: ## Build both workspaces
	pnpm build

.PHONY: verify
verify: lint typecheck test build ## The full pre-push gate
	@echo ""
	@echo -e "$(C_OK)Gates passed.$(C_OFF)"
	@echo -e "$(C_DIM)Not covered here: the live E2E suite (make test-e2e) and the browser suite.$(C_OFF)"

# =============================================================================
## Images
# =============================================================================

.PHONY: images
images: ## Build both images (TAG=<sha>)
	docker build -t $(BACKEND_IMAGE):$(TAG)  -f backend/Dockerfile  backend
	@echo -e "$(C_DIM)Frontend: NEXT_PUBLIC_* values are INLINED AT BUILD TIME — a different API URL$(C_OFF)"
	@echo -e "$(C_DIM)or a tenant-pinned build is a DIFFERENT IMAGE.$(C_OFF)"
	docker build -t $(FRONTEND_IMAGE):$(TAG) -f frontend/Dockerfile frontend \
		--build-arg NEXT_PUBLIC_API_BASE_URL="$(NEXT_PUBLIC_API_BASE_URL)" \
		--build-arg NEXT_PUBLIC_TENANT_ID="$(NEXT_PUBLIC_TENANT_ID)"

.PHONY: push
push: ## Push both images (TAG=<sha>)
	@[ "$(TAG)" != "latest" ] || { echo -e "$(C_ERR)Refusing to push :latest — pin a tag.$(C_OFF)"; exit 1; }
	docker push $(BACKEND_IMAGE):$(TAG)
	docker push $(FRONTEND_IMAGE):$(TAG)

# =============================================================================
## Deployment — compose
# =============================================================================

.PHONY: deploy
deploy: preflight ## Deploy with compose (ENV=staging|prod TAG=<sha>)
	$(DC) pull
	$(DC) up -d
	@$(MAKE) --no-print-directory wait-healthy
	@$(MAKE) --no-print-directory postdeploy

.PHONY: deploy-staging
deploy-staging: ## Deploy to staging
	$(MAKE) deploy ENV=staging TAG=$(TAG)

.PHONY: deploy-prod
deploy-prod: ## Deploy to production
	$(MAKE) deploy ENV=prod TAG=$(TAG)

.PHONY: rollback
rollback: ## Roll back to a previous tag (TAG=<previous-sha>)
	@[ "$(TAG)" != "latest" ] || { echo -e "$(C_ERR)Specify the previous tag: make rollback TAG=<sha>$(C_OFF)"; exit 1; }
	@echo -e "$(C_WARN)Application code rolls back cleanly. MIGRATIONS DO NOT.$(C_OFF)"
	@echo -e "$(C_DIM)If this release dropped or renamed anything, the previous code cannot run$(C_OFF)"
	@echo -e "$(C_DIM)against this schema — roll forward instead. See docs/DEVOPS/08-ROLLBACK.md.$(C_OFF)"
	@read -p "Continue? [y/N] " c; [ "$$c" = "y" ] || exit 1
	$(DC) up -d
	@$(MAKE) --no-print-directory wait-healthy
	@$(MAKE) --no-print-directory postdeploy

# =============================================================================
## Deployment — Helm
# =============================================================================

.PHONY: helm-lint
helm-lint: ## Lint the umbrella chart
	helm lint $(HELM_DIR) -f $(HELM_DIR)/values-$(ENV).yaml --set backend.image.tag=$(TAG) --set frontend.image.tag=$(TAG)

.PHONY: helm-template
helm-template: ## Render the manifests
	helm template $(RELEASE) $(HELM_DIR) -f $(HELM_DIR)/values-$(ENV).yaml \
		--set backend.image.tag=$(TAG) --set frontend.image.tag=$(TAG)

.PHONY: helm-deploy
helm-deploy: ## Install or upgrade (ENV=staging|prod TAG=<sha>)
	@[ "$(TAG)" != "latest" ] || { echo -e "$(C_ERR)Refusing :latest — a rollback needs something to roll back to.$(C_OFF)"; exit 1; }
	helm upgrade --install $(RELEASE) $(HELM_DIR) \
		--namespace $(NAMESPACE) --create-namespace \
		-f $(HELM_DIR)/values-$(ENV).yaml \
		--set backend.image.tag=$(TAG) --set frontend.image.tag=$(TAG) \
		--wait --timeout 10m

.PHONY: helm-rollback
helm-rollback: ## Roll back the Helm release
	helm rollback $(RELEASE) --namespace $(NAMESPACE) --wait

# =============================================================================
## Checks
# =============================================================================

.PHONY: check-env
check-env: ## Verify .env exists and carries the required secrets
	@if [ ! -f $(COMPOSE_DIR)/.env ]; then
		echo -e "$(C_ERR)$(COMPOSE_DIR)/.env is missing. Run: make env$(C_OFF)"
		exit 1
	fi
	@missing=""
	@for v in CERT_SIGNING_SECRET ENCRYPT_KEY ATTACHMENT_URL_SECRET; do
		val=$$(grep "^$$v=" $(COMPOSE_DIR)/.env | cut -d= -f2-)
		if [ -z "$$val" ] || [ "$$val" = "CHANGE_ME_64_HEX" ]; then missing="$$missing $$v"; fi
	done
	@if [ -n "$$missing" ]; then
		echo -e "$(C_ERR)Required secrets not set:$$missing$(C_OFF)"
		echo -e "$(C_DIM)The application exits without them, by design. Run: make secrets$(C_OFF)"
		exit 1
	fi

.PHONY: preflight
preflight: check-env ## Pre-deployment checks for staging and production
	@echo -e "$(C_BOLD)Preflight — ENV=$(ENV) TAG=$(TAG)$(C_OFF)"
	@[ "$(TAG)" != "latest" ] || { echo -e "$(C_ERR)Refusing :latest outside dev — a rollback needs something to roll back to.$(C_OFF)"; exit 1; }
	@env=$$(grep '^NODE_ENV=' $(COMPOSE_DIR)/.env | cut -d= -f2)
	@if [ "$(ENV)" = "prod" ] && [ "$$env" != "production" ]; then
		echo -e "$(C_ERR)NODE_ENV is \"$$env\", not \"production\".$(C_OFF)"
		echo -e "$(C_DIM)NODE_ENV gates CORS, the rate limit (100,000/15min outside production!) and$(C_OFF)"
		echo -e "$(C_DIM)error detail in responses.$(C_OFF)"
		exit 1
	fi
	@if grep -q '^SEED_DEMO=true' $(COMPOSE_DIR)/.env; then
		echo -e "$(C_ERR)SEED_DEMO=true. A demo seeder against real data is a data-integrity incident.$(C_OFF)"
		exit 1
	fi
	@if grep -q '^CORS_ORIGIN=\*' $(COMPOSE_DIR)/.env; then
		echo -e "$(C_ERR)CORS_ORIGIN is a wildcard. This policy runs with credentials:true — a wildcard$(C_OFF)"
		echo -e "$(C_ERR)would let any site make authenticated cross-origin requests.$(C_OFF)"
		exit 1
	fi
	@if [ "$(ENV)" = "prod" ] && grep -q 'acme-staging' $(COMPOSE_DIR)/.env; then
		echo -e "$(C_ERR)ACME_DIRECTORY_URL points at Let's Encrypt STAGING.$(C_OFF)"
		echo -e "$(C_DIM)Staging certificates are trusted by no browser, and the failure appears in a$(C_OFF)"
		echo -e "$(C_DIM)browser rather than in any log.$(C_OFF)"
		exit 1
	fi
	@echo -e "$(C_OK)Preflight passed.$(C_OFF)"

.PHONY: postdeploy
postdeploy: ## Post-deployment verification
	@echo ""
	@echo -e "$(C_BOLD)Verify before calling this done:$(C_OFF)"
	@echo "  [ ] /health returns 200 with database: \"connected\""
	@echo "  [ ] a user can log in"
	@echo "  [ ] a tenant-scoped list returns that tenant's rows AND NO OTHERS"
	@echo "  [ ] a certificate issued BEFORE this deploy still verifies at its public URL"
	@echo "  [ ] an attachment uploaded before this deploy still downloads"
	@echo "  [ ] migrate-status reports nothing unexpected"
	@echo "  [ ] schedulers run on EXACTLY ONE instance"
	@echo ""
	@echo -e "$(C_DIM)The certificate check is the one that catches a deploy that lost a secret —$(C_OFF)"
	@echo -e "$(C_DIM)without it, a broken configuration looks successful for weeks.$(C_OFF)"
	@echo ""

# =============================================================================
## Housekeeping
# =============================================================================

.PHONY: clean
clean: ## Remove build artefacts and node_modules
	pnpm clean || true
	rm -rf backend/dist frontend/.next frontend/dist
	find . -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true

.PHONY: format
format: ## Format the workspace
	pnpm format
