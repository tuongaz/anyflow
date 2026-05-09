# NestJS hints

## Route shapes to look for

NestJS uses decorators:

```ts
@Controller('orders')
export class OrdersController {
  @Get()        listOrders() {}
  @Get(':id')   getOrder() {}
  @Post()       createOrder() {}
}
```

The `extract-routes.mjs` Nest regex catches `@Get(...)`, `@Post(...)`, etc.,
but **does not resolve the `@Controller` prefix**. The wiring-builder agent
should:

1. Read the file containing the matched decorator.
2. Find the `@Controller('prefix')` at the top of the class.
3. Compose the full route as `<prefix>/<decorator-arg>`.

If the agent can't find the prefix, it should leave the route as the
decorator argument and add a `// TODO: prefix` note in the harness handler
(Tier 2) or warn the user (Tier 1).

## Common entry-point

- `src/main.ts` with `NestFactory.create(...)` and `await app.listen(port)`.

## Tier notes

- **Tier 1**: Often heavy startup (~5s) due to dependency injection. Confirm
  port and `npm run start:dev` script.
- **Tier 2**: Recommended for many Nest apps because they often pull in
  databases and message queues. The mock harness avoids the boot cost.
