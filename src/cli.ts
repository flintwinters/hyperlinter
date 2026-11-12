#!/usr/bin/env tsx
import { runCli } from './cli/index';

await runCli(process.argv.slice(2));
