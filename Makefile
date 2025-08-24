# =========
# FamilyWall Makefile (prod)
# =========

SHELL := /bin/bash

# Paths
PROD_DIR := docker/prod
COMPOSE  := docker compose -f $(PROD_DIR)/docker-compose.yml

# Tagging
GIT_SHA    := $(shell git rev-parse --short HEAD 2>/dev/null || echo "local")
IMAGE_TAG ?= $(GIT_SHA)

# State (för rollback)
STATE := .deploy_state
PREV  := .deploy_prev

# Services
SERVICES := backend frontend shopping ai

.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Targets:"
	@echo "  deploy           Bygg & starta med IMAGE_TAG=$(IMAGE_TAG) + uppdatera rollback-state"
	@echo "  rollback         Starta om stacken med föregående IMAGE_TAG (från $(PREV))"
	@echo "  prod-build       Bygg alla tjänster (IMAGE_TAG-styrt)"
	@echo "  prod-up          Starta/uppgradera stack (IMAGE_TAG-styrt)"
	@echo "  prod-down        Stoppa och ta ned stacken"
	@echo "  prod-restart     Snabb omstart (bygger också)"
	@echo "  ps               Visa containers i stacken"
	@echo "  logs             Följ samlade loggar"
	@echo "  logs-%           Följ loggar för tjänst (t.ex. make logs-backend)"
	@echo "  restart-%        Restart av tjänst (t.ex. make restart-backend)"
	@echo "  show-tags        Lista lokala images & taggar"
	@echo "  retag            Tagga :current och :prev för alla services"
	@echo "  ports            Visa öppna portar (80,3000,3443,3002,5001)"
	@echo "  smoke            Snabba curl-tester mot tjänster"
	@echo "  prune-safe       Rensa dangling images/containers/net utan att skada rollback"
	@echo "  prune-all        Aggressiv rensning (kan förstöra rollback)"
	@echo "  build-frontend   npm build av frontend (lokalt)"
	@echo
	@echo "Använd: IMAGE_TAG=<tag> make prod-up   # för att testa specifik tag"

# ----- Deploy & Rollback -----

.PHONY: deploy
deploy:
	@old=$$(cat $(STATE) 2>/dev/null || true); \
	echo $$old > $(PREV); \
	echo $(IMAGE_TAG) > $(STATE); \
	echo "Deploy: IMAGE_TAG=$(IMAGE_TAG) (prev=$$old)"; \
	IMAGE_TAG=$(IMAGE_TAG) $(COMPOSE) build --pull; \
	IMAGE_TAG=$(IMAGE_TAG) $(COMPOSE) up -d; \
	$(MAKE) retag --no-print-directory
	@echo "✅ Deployerad tag: $(IMAGE_TAG). Föregående: $$(cat $(PREV) 2>/dev/null || echo '-')"
	kiosk-restart

.PHONY: rollback
rollback:
	@prev=$$(cat $(PREV) 2>/dev/null || echo ""); \
	test -n "$$prev" || { echo "Ingen föregående tag i $(PREV). Avbryter."; exit 1; }; \
	echo "Rollback till $$prev..."; \
	IMAGE_TAG=$$prev $(COMPOSE) up -d; \
	echo $$prev > $(STATE); \
	$(MAKE) retag --no-print-directory
	@echo "✅ Rullat tillbaka till: $$(cat $(STATE))"
	kiosk-restart

# ----- Bygg & kör -----

.PHONY: prod-build
prod-build:
	IMAGE_TAG=$(IMAGE_TAG) $(COMPOSE) build --pull

.PHONY: prod-up
prod-up:
	IMAGE_TAG=$(IMAGE_TAG) $(COMPOSE) up -d --build
	sudo systemctl --user restart familywall-kiosk.service


.PHONY: prod-down
prod-down:
	$(COMPOSE) down

.PHONY: prod-restart
prod-restart:
	$(MAKE) prod-up

# ----- Drift-hjälp -----

.PHONY: ps
ps:
	$(COMPOSE) ps

.PHONY: logs
logs:
	$(COMPOSE) logs -f --tail=200

.PHONY: logs-%
logs-%:
	$(COMPOSE) logs -f --tail=200 $*

.PHONY: restart-%
restart-%:
	$(COMPOSE) restart $*

.PHONY: show-tags
show-tags:
	@docker images "familywall/*" --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}' | sort

# Tagga senaste deploy som :current och föregående som :prev
.PHONY: retag
retag:
	@curr=$$(cat $(STATE) 2>/dev/null || echo ""); \
	prev=$$(cat $(PREV) 2>/dev/null || echo ""); \
	for s in $(SERVICES); do \
	  test -n "$$curr" && docker tag familywall/$$s:$$curr familywall/$$s:current || true; \
	  test -n "$$prev" && docker tag familywall/$$s:$$prev familywall/$$s:prev || true; \
	done; \
	echo "Retaggat :current=$$curr, :prev=$$prev"

.PHONY: ports
ports:
	@ss -lntp | egrep ':80|:3000|:3443|:3002|:5001' || true

.PHONY: smoke
smoke:
	@set -e; \
	echo "Frontend (80)";  curl -I -s http://localhost/ | sed -n '1p'; \
	echo "Shopping (3002)"; curl -I -s http://localhost:3002/ | sed -n '1p'; \
	echo "Backend http (3000)"; curl -I -s http://localhost:3000/ | sed -n '1p'; \
	echo "Backend https (3443)"; curl -I -ks https://localhost:3443/ | sed -n '1p'; \
	echo "AI (5001) /health"; curl -s http://localhost:5001/api/health || true; echo

.PHONY: prune-safe
prune-safe:
	docker system prune -f

.PHONY: prune-all
prune-all:
	docker system prune -af

# ----- Bygg frontend (lokalt) -----

.PHONY: build-frontend
build-frontend:
	cd frontend && npm ci && npm run build
	kiosk-restart
