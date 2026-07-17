.PHONY: setup dev test lint lint-fix ci routes console db-migrate db-rollback db-reset deploy security

setup:
	bin/setup

dev:
	bin/dev

test:
	bin/rails test

lint:
	bundle exec rubocop

lint-fix:
	bundle exec rubocop -A

ci:
	bin/ci

routes:
	bin/rails routes

console:
	bin/rails console

db-migrate:
	bin/rails db:migrate

db-rollback:
	bin/rails db:rollback

db-reset:
	bin/rails db:drop db:create db:migrate db:seed

security:
	bundle exec brakeman --no-pager

deploy:
	bundle exec kamal deploy
