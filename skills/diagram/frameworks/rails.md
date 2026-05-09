# Rails hints

## Route shapes to look for

Routes live in `config/routes.rb`:

```rb
Rails.application.routes.draw do
  get 'orders', to: 'orders#index'
  post 'orders', to: 'orders#create'
  resources :orders
end
```

The `extract-routes.mjs` Rails pattern matches `<method> '...', to:`. It does
**not** expand `resources :orders` — the agent should recognize `resources`
calls and treat them as 7 RESTful routes (index/show/new/create/edit/update/destroy).

## Common entry points

- `bin/rails server` or `rails s` (often `Procfile` with `puma`)
- `config.ru` — Rack entry point, read for application root

## Tier notes

- **Tier 1**: Rails almost always needs a database — recommend Tier 2 unless
  `docker compose up` brings up postgres+redis+rails together.
- **Tier 2**: Mock harness stubs HTTP routes; does NOT run Ruby code.
- **Action Cable / Sidekiq**: If found, model these as `event` connectors
  pointing at `stateNode`s with `stateSource: { kind: 'event' }`. The
  harness can drive them via `emit()`.
