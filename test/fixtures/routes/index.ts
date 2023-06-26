import {type Context, type Next} from 'koa';

export async function get(ctx: Context, next: Next) {
  ctx.body = 'hello test';
}
