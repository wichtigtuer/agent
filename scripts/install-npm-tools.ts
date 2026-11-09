// install-npm-tools.ts — install the globally available npm tools pinned in
// package.json.
//
// Dependabot updates package.json (and package-lock.json); this script runs
// during the Docker build so the image always contains the pinned versions.
// Executed with Node.js type stripping:
//
//   node --experimental-strip-types scripts/install-npm-tools.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifest = join(dirname(fileURLToPath(import.meta.url)), 'package.json');

const { dependencies } = JSON.parse(readFileSync(manifest, 'utf8')) as {
	dependencies: Record<string, string>;
};

for (const [name, version] of Object.entries(dependencies)) {
	const pkg = `${name}@${version}`;
	console.log(`Installing ${pkg}`);
	// pnpm's postinstall installs its native binary (@pnpm/exe). Skipping it
	// leaves pnpm running through Node.js, so allow its build scripts to run.
	const args = ['install', '-g', pkg];
	if (name !== 'pnpm') args.push('--ignore-scripts');
	execFileSync('npm', args, {
		stdio: 'inherit',
	});
}
