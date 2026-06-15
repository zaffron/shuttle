# Shuttle — SSH tunnel manager (Tauri + React)
# Run `make` or `make help` to list available targets.

PNPM         ?= pnpm
MANIFEST     := src-tauri/Cargo.toml
APP_NAME     := Shuttle
BUNDLE_DIR   := src-tauri/target/release/bundle
APP_BUNDLE   := $(BUNDLE_DIR)/macos/$(APP_NAME).app
ICON_SRC     := src-tauri/icons/shuttle.png
INSTALL_DIR  := /Applications

.DEFAULT_GOAL := help

## ---------------------------------------------------------------------------
## Setup
## ---------------------------------------------------------------------------

.PHONY: deps
deps: ## Install JS dependencies and fetch Rust crates
	$(PNPM) install
	cargo fetch --manifest-path $(MANIFEST)

.PHONY: icons
icons: ## Regenerate all app icons from src-tauri/icons/shuttle.png
	$(PNPM) tauri icon $(ICON_SRC)

## ---------------------------------------------------------------------------
## Develop
## ---------------------------------------------------------------------------

.PHONY: dev
dev: ## Run the app in development mode with hot reload
	$(PNPM) tauri dev

.PHONY: frontend
frontend: ## Build only the web frontend (tsc + vite)
	$(PNPM) build

## ---------------------------------------------------------------------------
## Quality
## ---------------------------------------------------------------------------

.PHONY: check
check: ## Type-check the frontend and the Rust backend
	$(PNPM) exec tsc --noEmit
	cargo check --manifest-path $(MANIFEST)

.PHONY: fmt
fmt: ## Format Rust code
	cargo fmt --manifest-path $(MANIFEST)

.PHONY: lint
lint: ## Lint Rust code with clippy
	cargo clippy --manifest-path $(MANIFEST) -- -D warnings

## ---------------------------------------------------------------------------
## Build & package
## ---------------------------------------------------------------------------

.PHONY: build
build: ## Build release bundles (.app + .dmg)
	$(PNPM) tauri build

.PHONY: build-debug
build-debug: ## Build bundles with debug symbols (faster, larger)
	$(PNPM) tauri build --debug

.PHONY: dmg
dmg: build ## Build and reveal the generated .dmg
	@open $(BUNDLE_DIR)/dmg 2>/dev/null || true
	@ls -1 $(BUNDLE_DIR)/dmg/*.dmg 2>/dev/null || echo "No .dmg produced"

## ---------------------------------------------------------------------------
## Install & run
## ---------------------------------------------------------------------------

.PHONY: install
install: build ## Install the built app into /Applications
	@rm -rf "$(INSTALL_DIR)/$(APP_NAME).app"
	cp -R "$(APP_BUNDLE)" "$(INSTALL_DIR)/"
	@echo "Installed $(APP_NAME).app to $(INSTALL_DIR)"

.PHONY: open
open: ## Open the built .app bundle
	@open "$(APP_BUNDLE)" 2>/dev/null || echo "Not built yet — run 'make build'"

## ---------------------------------------------------------------------------
## Cleanup
## ---------------------------------------------------------------------------

.PHONY: clean
clean: ## Remove build artifacts (dist + Rust target)
	rm -rf dist
	cargo clean --manifest-path $(MANIFEST)

.PHONY: distclean
distclean: clean ## Also remove node_modules
	rm -rf node_modules

## ---------------------------------------------------------------------------

.PHONY: help
help: ## Show this help
	@echo "Shuttle — available make targets:"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-13s\033[0m %s\n", $$1, $$2}'
	@echo ""
