import path from 'node:path';
import test from 'ava';
import koa from 'koa';
import createRouter from '../src';

const router = createRouter(path.join(__dirname, 'fixtures/routes'));

test('just a test!', (t) => {
  t.pass();
});
