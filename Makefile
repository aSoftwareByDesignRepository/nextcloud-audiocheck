# Makefile for AudioCheck app release

app_name = audiocheck
build_dir = build
release_dir = $(build_dir)/release
version = $(shell grep '^\s*<version>' appinfo/info.xml | sed 's/.*<version>\([0-9.]*\)<\/version>.*/\1/' | head -1)
archive_name = $(app_name)-$(version).tar.gz
archive_path = $(release_dir)/$(archive_name)
occ = ../../occ
SIGN_KEY := $(if $(strip $(APP_CERT_KEY_PATH)),$(APP_CERT_KEY_PATH),$(HOME)/.nextcloud/certificates/$(app_name).key)
SIGN_CRT := $(if $(strip $(APP_CERT_CRT_PATH)),$(APP_CERT_CRT_PATH),$(HOME)/.nextcloud/certificates/$(app_name).crt)
ready2publish_sign = ../../ready2publish/scripts/sign-nextcloud-appstore-archive.sh

.PHONY: release verify-release verify-signature-manifest sign-release release-signed sign-tarball clean test test-docker

release:
	@echo "Building $(app_name) v$(version)..."
	@mkdir -p $(release_dir)
	@staging=$$(mktemp -d) && \
		mkdir -p "$$staging/$(app_name)" && \
		rsync -a --exclude='.git' --exclude='$(build_dir)' --exclude='.github' \
			--exclude='node_modules' --exclude='tests' --exclude='.phpunit.result.cache' \
			--exclude='test-results' --exclude='scripts' --exclude='release/*.tar.gz' --exclude='release/*.asc' \
			--exclude='appinfo/signature.json' \
			./ "$$staging/$(app_name)/" && \
		tar -czf $(archive_path) -C "$$staging" $(app_name) && \
		rm -rf "$$staging"
	@echo "Created $(archive_path)"

verify-release:
	@test -f $(archive_path) || (echo "Error: Run 'make release' first"; exit 1)
	@if tar -tzf $(archive_path) | grep -Eq '/(\.git/|node_modules/|build/|tests/|test-results/|scripts/)'; then \
		echo "Error: release archive contains forbidden development paths"; \
		tar -tzf $(archive_path) | grep -E '/(\.git/|node_modules/|build/|tests/|test-results/|scripts/)' || true; \
		exit 1; \
	fi
	@echo "Release archive layout looks clean."

verify-signature-manifest:
	@test -f $(archive_path) || (echo "Error: Run 'make release-signed' first"; exit 1)
	@tmpdir=$$(mktemp -d) && \
		trap 'rm -rf "$$tmpdir"' EXIT && \
		tar -xzf $(archive_path) -C "$$tmpdir" "$(app_name)/appinfo/signature.json" && \
		sig="$$tmpdir/$(app_name)/appinfo/signature.json" && \
		if ! test -f "$$sig"; then \
			echo "Error: signature.json missing from signed archive"; \
			exit 1; \
		fi && \
		if grep -Eq '"([^"]*/)?(\.git|node_modules|build|tests|test-results|scripts)\\/' "$$sig"; then \
			echo "Error: signature.json references forbidden development paths"; \
			exit 1; \
		fi && \
		echo "signature.json looks clean."

sign-release:
	@test -f $(archive_path) || (echo "Error: Run 'make release' first"; exit 1)
	@$(ready2publish_sign) "$(SIGN_KEY)" "$(SIGN_CRT)" "$(archive_path)"

release-signed: release sign-release verify-signature-manifest

sign-tarball:
	@test -n "$(TARBALL)" || (echo "Usage: make sign-tarball TARBALL=build/release/audiocheck-x.y.z.tar.gz"; exit 1)
	@$(ready2publish_sign) "$(SIGN_KEY)" "$(SIGN_CRT)" "$(TARBALL)"

clean:
	@rm -rf $(build_dir) .phpunit.result.cache test-results

test:
	composer install --no-interaction
	./vendor/bin/phpunit
	npm test
	bash scripts/check-file-access-gate.sh
	bash scripts/check-no-outbound-http.sh

test-docker:
	bash scripts/run-docker-tests.sh
