import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { transformFileSync } from '@babel/core';
import commonjs from '@babel/plugin-transform-modules-commonjs';
import compiler from '@stylexjs/babel-plugin';
import * as stylex from '@stylexjs/stylex';

const filename = fileURLToPath(new URL('./styles.stylex.js', import.meta.url));
const compiled = transformFileSync(filename, {
  babelrc: false, configFile: false,
  plugins: [[compiler, { dev: false, runtimeInjection: false, styleResolution: 'application-order', propertyValidationMode: 'throw', unstable_moduleResolution: { type: 'commonJS' } }], commonjs],
});
const exports = {};
vm.runInNewContext(compiled.code, { exports, require: createRequire(import.meta.url) }, { filename });
const { styles } = exports;
const requests = JSON.parse(readFileSync(0, 'utf8'));
const classes = requests.map(({ tag, names }) => {
  const ordered = ['reset', ...(names.includes('wrap') ? ['wrap'] : []), tag === 'header' ? 'headerBorder' : tag,
    ...names.filter(name => name !== 'wrap')];
  for (const name of names) if (!(name in styles)) throw new Error(`Unknown site style: ${name}`);
  return stylex.props(...ordered.map(name => styles[name]).filter(Boolean)).className;
});
process.stdout.write(JSON.stringify({ classes, css: compiler.processStylexRules(compiled.metadata.stylex) }));
