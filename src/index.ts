import process from 'node:process';
import path from 'node:path';
import {type Middleware, type Context} from 'koa';
import fg from 'fast-glob';
import type {MatchFunction} from 'path-to-regexp';
import {match as createMatchFn} from 'path-to-regexp';
import compose from '@kosmic/compose';

declare module 'koa' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Request {
    params?: Record<string, unknown>;
  }
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

type RouteModule = Partial<Record<Method, Middleware>> & {
  weight?: number;
  useBefore?: Middleware[];
  useAfter?: Middleware[];
};

type RouteDefinition = {
  uriPath: string;
  filePath: string;
  match: MatchFunction<Record<string, unknown>>;
  module: RouteModule;
  middleware?: Middleware;
  params?: Record<string, unknown>;
};

async function createFsRouter(
  routesDir = path.join(process.cwd(), 'routes'),
): Promise<Middleware> {
  const middlewareByFileDir: {
    before: Record<string, Middleware>;
    after: Record<string, Middleware>;
  } = {before: {}, after: {}};

  const files = await fg(`${routesDir}/**/*`);

  const routesPromises: Array<Promise<RouteDefinition>> = files.map(
    async (filePath) => {
      let uriPath = filePath
        .replace(routesDir, '')
        .replace(/(\.js)|(\.ts)/, '')
        .replaceAll('/index', '')
        .replace(/\/*$/, '');

      if (uriPath === '') uriPath = '/';

      if (uriPath.includes('?')) {
        throw new Error(
          'fs-router does not support optional parameters in filenames',
        );
      }

      const module = (await import(filePath)) as RouteModule;

      const middlewareBefore = module.useBefore && compose(module.useBefore);

      const middlewareAfter = module.useAfter && compose(module.useAfter);

      if (middlewareBefore)
        middlewareByFileDir.before[path.dirname(filePath)] = middlewareBefore;

      if (middlewareAfter)
        middlewareByFileDir.after[path.dirname(filePath)] = middlewareAfter;

      return {
        filePath,
        uriPath,
        match: createMatchFn<Record<string, unknown>>(uriPath),
        module,
        middlewareBefore,
        middlewareAfter,
      };
    },
  );

  // eslint-disable-next-line unicorn/no-await-expression-member
  const routes = (await Promise.all(routesPromises)).sort(
    (a, b) => (b.module?.weight ?? 100) - (a.module.weight ?? 100),
  );

  console.log('route', routes);
  console.log('middlewareByFileDir', middlewareByFileDir);

  return async function (ctx: Context, next) {
    const matchedHandler = routes.find((route) => {
      const [url] = ctx.originalUrl?.split('?') ?? [];
      const match = route.match(url);

      if (match) {
        route.params = match.params;
      }

      return match;
    });

    if (!matchedHandler) return next();

    const fn = matchedHandler?.module?.[ctx.method?.toLowerCase() as Method];

    if (!fn || typeof fn !== 'function') return next();

    const middleware: Middleware[] = [];

    if (matchedHandler) {
      for (const fileDir of Object.keys(middlewareByFileDir)) {
        if (path.dirname(matchedHandler.filePath).includes(fileDir)) {
          middleware.push(middlewareByFileDir.before[fileDir]);
        }
      }
    }

    if (middleware.length > 0) {
      await compose(middleware)(ctx, next);
    }

    ctx.request.params = matchedHandler?.params;

    await fn(ctx, next);
  };
}

export = createFsRouter;
