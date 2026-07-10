#!/usr/bin/env node

const baseDir = process.argv[2] ?? process.cwd();

import fs from 'node:fs';
import { simpleGit } from 'simple-git';
import { parse } from 'yaml';

if (!fs.existsSync(`${baseDir}/.github/workflows`)) {
  console.log(
    "No .github/workflows directory in your current directory '${process.cwd()}'.",
  );
  process.exit(1);
}

const basePath = `${baseDir}/.github/workflows`;

function collectFiles(dir: string): string[] {
  const result: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;

    if (entry.isDirectory()) {
      result.push(...collectFiles(full));
      continue;
    }

    const name = entry.name.toLowerCase();
    if (name.endsWith('.yml') || name.endsWith('.yaml')) {
      result.push(full);
    }
  }

  return result;
}

function resolveLocalUses(uses: string): string | null {
  const resolved = uses.startsWith('/')
    ? uses
    : `${baseDir}/${uses.replace(/^\.\//, '')}`;

  if (!fs.existsSync(resolved)) return null;

  if (fs.statSync(resolved).isDirectory()) {
    for (const name of ['action.yml', 'action.yaml']) {
      const candidate = `${resolved}/${name}`;
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  return resolved;
}

function usesFromSteps(steps: any[] | undefined): string[] {
  return (steps ?? []).filter((s: any) => s?.uses).map((s: any) => s.uses);
}

function getUsesDeclarations(yaml: any): string[] {
  const uses: string[] = [];

  for (const job of Object.values(yaml?.jobs ?? {}) as any[]) {
    if (job?.uses) uses.push(job.uses);
    uses.push(...usesFromSteps(job?.steps));
  }

  // composite actions
  uses.push(...usesFromSteps(yaml?.runs?.steps));

  return uses;
}

const visited = new Set<string>();
const files = collectFiles(basePath);

while (files.length > 0) {
  const path = files.shift()!;

  if (visited.has(path)) continue;
  visited.add(path);

  const content = fs.readFileSync(path, 'utf8');
  const yaml = parse(content);

  const uniqueUsesDeclarations: string[] = [
    ...new Set(getUsesDeclarations(yaml)),
  ];

  const notUpToDates = [];

  for (const usesDeclaration of uniqueUsesDeclarations) {
    if (
      usesDeclaration.startsWith('./') ||
      usesDeclaration.startsWith('../') ||
      usesDeclaration.startsWith('/')
    ) {
      const resolved = resolveLocalUses(usesDeclaration);
      if (resolved && !visited.has(resolved)) files.push(resolved);
      continue;
    }

    if (
      usesDeclaration.startsWith('docker://') ||
      !usesDeclaration.includes('@')
    ) {
      continue;
    }

    const split = usesDeclaration.split('@');
    const repo = split[0];
    const version = split[1];

    const safeRepo = repo.split('/').slice(0, 2).join('/');

    const tagsOutput = await simpleGit({
      config: ['versionsort.suffix=-'],
    }).listRemote([
      '--tags',
      '--sort=v:refname',
      `https://github.com/${safeRepo}.git`,
    ]);

    const tags = tagsOutput
      .split('\n')
      .map((v: string) => v.split('refs/tags/')[1])
      .filter((v: string) => !!v);

    const tagsByTagLengths: Record<number, string[] | undefined> = tags.reduce(
      (acc: any, v: string) => {
        const length = v.length;
        if (!acc[length]) {
          acc[length] = [];
        }

        acc[length].push(v);
        return acc;
      },
      {},
    );

    const single = tags.filter((v) => v.length === 2);
    const lastSingle = single[single.length - 1];

    const full = tags.filter((v) => {
      const match = v.match(
        /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9A-Za-z-][0-9A-Za-z-]*)(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/,
      );

      if (!match) return false;

      return match.length > 0;
    });
    const lastFull = full[full.length - 1];

    if (!lastSingle && !lastFull) {
      const tagsWithCorrectLength = tagsByTagLengths[version.length];
      if (tagsWithCorrectLength?.length) {
        const versionToCompare =
          tagsWithCorrectLength[tagsWithCorrectLength.length - 1];
        if (versionToCompare !== version) {
          notUpToDates.push(
            `  Action '${usesDeclaration}' has a newer version available: '${versionToCompare}'.${
              lastFull || lastSingle
                ? ` You can also upgrade to '${lastSingle}' or '${lastFull}'.`
                : ''
            }`,
          );
        }

        continue;
      } else {
        notUpToDates.push(
          `  Action '${usesDeclaration}' could not be checked. You can check available versions yourself: https://github.com/${repo}/tags`,
        );
        continue;
      }
    }

    const versionToCompare = version.length === 2 ? lastSingle : lastFull;

    if (versionToCompare !== version) {
      const latestVersions = [lastSingle, lastFull]
        .filter((v) => typeof v !== 'undefined')
        .map((v) => `'${v}'`)
        .join(' or ');

      notUpToDates.push(
        `  Action '${usesDeclaration}' has a newer version available: ${latestVersions}.`,
      );
    }
  }

  console.log(`Checked ${path} ${notUpToDates.length ? '✗' : '✓'}`);
  console.log(notUpToDates.join('\n'));
}
