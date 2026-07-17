Rails.application.configure do
  config.enable_reloading = false
  config.eager_load = true

  config.public_file_server.enabled = true
  config.public_file_server.headers = { "Cache-Control" => "public, max-age=3600" }

  config.consider_all_requests_local = true
  config.action_controller.perform_caching = false
  config.cache_store = :null_store

  config.active_storage.service = :test

  config.action_mailer.raise_delivery_errors = false
  config.action_mailer.default_url_options = { host: "localhost" }
  config.action_mailer.delivery_method = :test

  config.active_support.deprecation = :stderr
  config.active_support.disallowed_deprecation = :raise
  config.active_support.disallowed_deprecation_warnings = []

  config.action_dispatch.show_exceptions = :rescuable
end
