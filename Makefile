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

.PHONY: release verify-release verify-signature-manifest sign-release release-signed sign-tarball clean test test-ui test-docker composer-prod

composer-prod:
	composer install --no-dev --no-interaction --optimize-autoloader
	@test -f composer/autoload.php || (echo "Error: composer/autoload.php missing (Nextcloud will not load vendor/)"; exit 1)
	@php -r 'require "composer/autoload.php"; exit(class_exists("getID3") ? 0 : 1);' \
		|| (echo "Error: getID3 not autoloadable via composer/autoload.php"; exit 1)

release: composer-prod
	@echo "Building $(app_name) v$(version)..."
	@mkdir -p $(release_dir)
	@staging=$$(mktemp -d) && \
		mkdir -p "$$staging/$(app_name)" && \
		rsync -a --exclude='.git' --exclude='$(build_dir)' --exclude='.github' \
			--exclude='node_modules' --exclude='tests' --exclude='.phpunit.result.cache' \
			--exclude='test-results' --exclude='scripts' --exclude='release/*.tar.gz' --exclude='release/*.asc' \
			--exclude='appinfo/signature.json' \
			--exclude='phpunit.xml' --exclude='playwright.config.js' --exclude='playwright-report' \
			--exclude='e2e' --exclude='.auth' \
			./ "$$staging/$(app_name)/" && \
		test -f "$$staging/$(app_name)/composer/autoload.php" || (echo "Error: staging missing composer/autoload.php"; rm -rf "$$staging"; exit 1) && \
		test -d "$$staging/$(app_name)/vendor/james-heinrich/getid3" || (echo "Error: staging missing getID3"; rm -rf "$$staging"; exit 1) && \
		if find "$$staging/$(app_name)/vendor" -maxdepth 2 -type d \( -name phpunit -o -name nextcloud -o -name myclabs -o -name sebastian -o -name phar-io -o -name theseer \) | grep -q .; then \
			echo "Error: staging vendor still contains require-dev packages — run composer install --no-dev"; \
			rm -rf "$$staging"; \
			exit 1; \
		fi && \
		tar -czf $(archive_path) -C "$$staging" $(app_name) && \
		rm -rf "$$staging"
	@echo "Created $(archive_path)"

verify-release:
	@test -f $(archive_path) || (echo "Error: Run 'make release' first"; exit 1)
	@if tar -tzf $(archive_path) | grep -Eq '/(\.git/|node_modules/|build/|tests/|test-results/|scripts/|phpunit\.xml|vendor/(phpunit|nextcloud)/)'; then \
		echo "Error: release archive contains forbidden development paths"; \
		tar -tzf $(archive_path) | grep -E '/(\.git/|node_modules/|build/|tests/|test-results/|scripts/|phpunit\.xml|vendor/(phpunit|nextcloud)/)' || true; \
		exit 1; \
	fi
	@tmpdir=$$(mktemp -d) && \
		trap 'rm -rf "$$tmpdir"' EXIT && \
		tar -xzf $(archive_path) -C "$$tmpdir" "$(app_name)/composer/autoload.php" && \
		test -f "$$tmpdir/$(app_name)/composer/autoload.php" || (echo "Error: composer/autoload.php missing from archive"; exit 1)
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
	@test -f $(ready2publish_sign) || (echo "Error: Missing $(ready2publish_sign)"; exit 1)
	@APPSTORE_SIGNING_KEY="$(SIGN_KEY)" APPSTORE_SIGNING_CERT="$(SIGN_CRT)" bash "$(ready2publish_sign)" $(app_name) $(archive_path)

sign-tarball:
	@test -n "$(TARBALL)" || (echo "Usage: make sign-tarball TARBALL=build/release/audiocheck-x.y.z.tar.gz"; exit 1)
	@test -f $(ready2publish_sign) || (echo "Error: Missing $(ready2publish_sign)"; exit 1)
	@APPSTORE_SIGNING_KEY="$(SIGN_KEY)" APPSTORE_SIGNING_CERT="$(SIGN_CRT)" bash "$(ready2publish_sign)" $(app_name) "$(TARBALL)"

release-signed: release verify-release
	@echo "Release archive ready at $(archive_path). Run 'make sign-tarball' for App Store signature."

clean:
	@rm -rf $(build_dir) .phpunit.result.cache test-results

test:
	composer install --no-interaction
	./vendor/bin/phpunit
	npm test
	bash scripts/check-theme-tokens.sh
	bash scripts/check-hardcoded-colors.sh
	bash scripts/check-file-access-gate.sh
	bash scripts/check-no-outbound-http.sh

test-ui:
	set -a; [ -f e2e/.env ] && . ./e2e/.env; set +a; npm run test:ui:gauntlet

test-docker:
	bash scripts/run-docker-tests.sh
