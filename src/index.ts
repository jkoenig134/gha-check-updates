#!/usr/bin/env node

const baseDir = process.argv[2] ?? process.cwd()

import fs from "fs"
import { parse } from "yaml"
import { $ } from "zx"

if (!fs.existsSync(".github/workflows")) {
  console.log("No .github/workflows directory in your current directory '${process.cwd()}'.")
  process.exit(1)
}

const basePath = `${baseDir}/.github/workflows`

// find all files in the .github/workflows directory using nodejs fs
const files = fs.readdirSync(basePath)

for (const file of files) {
  const path = `${basePath}/${file}`

  const content = fs.readFileSync(path, "utf8")
  const yaml = parse(content)

  const jobs = yaml.jobs
  if (!jobs) {
    console.log(`No jobs in ${path}`)
    continue
  }

  const jobsValues = Object.values(jobs)
  const usesDeclarations = jobsValues
    .map((v: any) => v.steps)
    .flatMap((v: any) => v)
    .filter((v: any) => v.uses)
    .map((v: any) => v.uses)

  const uniqueUsesDeclarations: string[] = [...new Set(usesDeclarations)]

  $.verbose = false

  const upToDates = []
  const notUpToDates = []

  for (const usesDeclaration of uniqueUsesDeclarations) {
    const split = usesDeclaration.split("@")
    const repo = split[0]
    const version = split[1]

    const safeRepo = repo.split("/").slice(0, 2).join("/")

    const tagsOutput =
      await $`git -c 'versionsort.suffix=-' ls-remote --tags --sort='v:refname' https://github.com/${safeRepo}.git`
    const tags = tagsOutput.stdout
      .split("\n")
      .map((v: string) => v.split("refs/tags/")[1])
      .filter((v: string) => v && v.length < 7)

    // const tagsByTagLengths = tags.reduce((acc: any, v: string) => {
    //   const length = v.length
    //   if (!acc[length]) {
    //     acc[length] = []
    //   }

    //   acc[length].push(v)
    //   return acc
    // }, {})

    // console.log(tagsByTagLengths)

    const single = tags.filter((v) => v.length === 2)
    const lastSingle = single[single.length - 1]

    const full = tags.filter((v) => v.length === 6)
    const lastFull = full[full.length - 1]

    const versionToCompare = version.length === 2 ? lastSingle : lastFull
    if (versionToCompare !== version) {
      notUpToDates.push(
        `  Action '${usesDeclaration}' has a newer version available: '${lastSingle}' or '${lastFull}'.`
      )
    }
  }

  console.log(`Checked ${path} ${notUpToDates.length ? "✗" : "✓"}`)
  console.log(notUpToDates.join("\n"))
}
