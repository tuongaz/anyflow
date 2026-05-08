# AnyDemo — convenience wrapper over the bun commands documented in CLAUDE.md.
# `make help` (or just `make`) lists every target with its one-line description.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# `make register DIR=<path>` — DIR avoids clobbering the shell PATH env var.
DIR ?= .

CLI := bun run apps/studio/src/cli.ts

.PHONY: help install dev build typecheck lint format test clean start stop register example-order-pipeline ralph-clean

help: ## Show this target list
	@echo "AnyDemo — make targets"
	@echo ""
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""
	@echo "Variables (override on the command line):"
	@echo "  DIR=<path>   path passed to 'make register' (default: .)"
	@echo ""
	@echo "Examples:"
	@echo "  make dev"
	@echo "  make register DIR=examples/todo-demo-target"

install: ## Install all workspace deps via bun
	bun install

dev: ## Run Vite (5173) + Hono studio (4321) in parallel
	bun run dev

build: ## Build the prod web bundle into apps/studio/dist/web/
	cd apps/web && bun run build

typecheck: ## tsc --noEmit across all workspaces
	bun run typecheck

lint: ## biome check
	bun run lint

format: ## biome format --write (run before lint)
	bun run format

test: ## bun test
	bun test

start: ## Start the studio daemon (writes ~/.anydemo/anydemo.pid)
	$(CLI) start --daemon

stop: ## Stop the studio daemon (sends SIGTERM)
	$(CLI) stop

register: ## Register a demo: make register DIR=<path>
	$(CLI) register --path $(DIR)

example-order-pipeline: ## Run the order-pipeline example app (port 3040)
	cd examples/order-pipeline && bun start

clean: ## Remove node_modules + apps/studio/dist (preserves ~/.anydemo and examples/*/.anydemo/sdk)
	rm -rf node_modules apps/*/node_modules packages/*/node_modules examples/*/node_modules
	rm -rf apps/studio/dist

ralph-clean: ## Clear ralph state: progress.txt, prd.json, .last-branch, archive/
	rm -f ralph/progress.txt ralph/prd.json ralph/.last-branch
	rm -rf ralph/archive
