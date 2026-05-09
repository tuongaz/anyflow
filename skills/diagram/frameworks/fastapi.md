# FastAPI / Flask hints

## FastAPI route shapes

```py
@app.post('/orders')
async def create_order(...): ...

@router.get('/orders/{id}')
async def get_order(...): ...
```

The `extract-routes.mjs` FastAPI pattern matches `@<var>.<method>(...)`.

## Flask route shapes

```py
@app.route('/orders', methods=['POST'])
def create_order(): ...

@blueprint.route('/orders/<id>')
def get_order(id): ...
```

The Flask pattern matches `@<var>.route(...)`. The HTTP method comes from the
`methods=[...]` kwarg — read the line and the next 2-3 lines to extract it.

## Listening port

- `uvicorn main:app --port 8000` (FastAPI)
- `flask run --port 5000` (Flask)
- Often defined in `Procfile` or a top-level `Makefile`

## Tier notes

- **Tier 1**: FastAPI/Flask usually need Python deps installed and a virtual
  env. Confirm with the user before recommending Tier 1.
- **Tier 2**: The mock harness is *Bun + Hono*, not Python — it stubs the
  HTTP shape (path + method + plausible JSON) but does NOT run Python code.
  Make this clear in the generated harness README.
