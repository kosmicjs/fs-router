import process from 'node:process';
import path from 'node:path';
import {type Middleware} from 'koa';
import fg from 'fast-glob';
import type {MatchFunction, Match} from 'path-to-regexp';
import {match as createMatchFn} from 'path-to-regexp';
import compose from 'koa-compose';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

type RouteModule = Partial<Record<Method, Middleware>> & {
  weight?: number;
  useBefore?: Middleware[];
  useAfter?: Middleware[];
};

type RouteDefinition = {
  uriPath: string;
  filePath: string;
  match: MatchFunction;
  module: RouteModule;
  middleware?: Middleware;
  params?: unknown;
};

function createFsRouter(
  routesDir = path.join(process.cwd(), 'routes'),
): Middleware {
  const middlewareByFileDir: {
    before: Record<string, Middleware>;
    after: Record<string, Middleware>;
  } = {before: {}, after: {}};
  const routes: RouteDefinition[] = fg
    .sync(`${routesDir}/**/*`)
    .map((filePath) => {
      let uriPath = filePath
        .replace(routesDir, '')
        .replace(/(\.js)|(\.ts)/, '')
        .replace(/\/index/g, '')
        .replace(/\/*$/, '');

      if (uriPath === '') uriPath = '/';

      if (uriPath.includes('?')) {
        throw new Error(
          'fs-router does not support optional parameters in filenames',
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const module = require(filePath) as RouteModule;

      const middlewareBefore = module.useBefore && compose(module.useBefore);

      const middlewareAfter = module.useAfter && compose(module.useAfter);

      if (middlewareBefore)
        middlewareByFileDir.before[path.dirname(filePath)] = middlewareBefore;

      if (middlewareAfter)
        middlewareByFileDir.after[path.dirname(filePath)] = middlewareAfter;

      return {
        filePath,
        uriPath,
        match: createMatchFn(uriPath),
        module,
        middlewareBefore,
        middlewareAfter,
      };
    })
    .sort((a, b) => (b.module?.weight ?? 100) - (a.module.weight ?? 100));

  // console.log('route', routes);
  // console.log('middlewareByFileDir', middlewareByFileDir);

  return async function (ctx, next) {
    const matchedHandler = routes.find((route) => {
      const [url] = ctx.url.split('?');
      const match = route.match(url);

      if (match) {
        route.params = match.params;
      }

      return match;
    });

    if (!matchedHandler) return next();

    const fn = matchedHandler?.module?.[ctx.method.toLowerCase() as Method];

    if (!fn || typeof fn !== 'function') return next();

    const middleware: Middleware[] = [];

    if (matchedHandler) {
      for (const fileDir of Object.keys(middlewareByFileDir)) {
        if (path.dirname(matchedHandler.filePath).includes(fileDir)) {
          middleware.push(middlewareByFileDir[fileDir]);
        }
      }
    }

    if (middleware.length > 0) {
      await compose(middleware)(ctx, next);
    }

    ctx.state.params = matchedHandler?.params;

    await fn(ctx, next);
  };
}

export default createFsRouter;
