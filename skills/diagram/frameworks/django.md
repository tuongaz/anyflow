# Django hints

## URL configuration

Django routes live in `urls.py`:

```py
urlpatterns = [
  path('orders/', views.create_order),
  path('orders/<int:id>/', views.get_order),
]
```

The `extract-routes.mjs` Django pattern matches `path('...')`. HTTP method
is **not** in the pattern — methods are gated by view-function logic
(`if request.method == 'POST'`) or DRF `@api_view([...])` decorators.

## DRF view decorators

```py
@api_view(['GET', 'POST'])
def order_list(request): ...
```

The agent should grep for `@api_view\(\[(.+?)\]\)` in the same file to recover
methods, then cross-reference with the URL pattern.

## Common entry points

- `manage.py runserver` (development)
- `wsgi.py` / `asgi.py` (production deployment target)
- `gunicorn project.wsgi` in a `Procfile`

## Tier notes

- **Tier 1**: Django requires database connection and migrations. Often the
  user does NOT have a trivial `make dev` target. Recommend Tier 2 unless
  there's a `docker compose up` that brings up the whole stack.
- **Tier 2**: Mock harness covers HTTP routes only — the agent must NOT
  pretend to mock Django ORM behavior.
