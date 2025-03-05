#!/usr/bin/env node

const baseDir = process.argv[2] ?? process.cwd()

import fs from "fs"
import { simpleGit } from "simple-git"
import { parse } from "yaml"

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

  const notUpToDates = []

  for (const usesDeclaration of uniqueUsesDeclarations) {
    const split = usesDeclaration.split("@")
    const repo = split[0]
    const version = split[1]

    const safeRepo = repo.split("/").slice(0, 2).join("/")

    const tagsOutput = await simpleGit({
      config: ["versionsort.suffix=-"],
    }).listRemote(["--tags", "--sort=v:refname", `https://github.com/${safeRepo}.git`])

    const tags = tagsOutput
      .split("\n")
      .map((v: string) => v.split("refs/tags/")[1])
      .filter((v: string) => !!v)

    const tagsByTagLengths: Record<number, string[] | undefined> = tags.reduce((acc: any, v: string) => {
      const length = v.length
      if (!acc[length]) {
        acc[length] = []
      }

      acc[length].push(v)
      return acc
    }, {})

    const single = tags.filter((v) => v.length === 2)
    const lastSingle = single[single.length - 1]

    const full = tags.filter((v) => {
      const match = v.match(
        /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(0|[1-9A-Za-z-][0-9A-Za-z-]*)(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
      )

      if (!match) return false

      return match.length > 0
    })
    const lastFull = full[full.length - 1]

    if (!lastSingle && !lastFull) {
      const tagsWithCorrectLength = tagsByTagLengths[version.length]
      if (tagsWithCorrectLength?.length) {
        const versionToCompare = tagsWithCorrectLength[tagsWithCorrectLength.length - 1]
        if (versionToCompare !== version) {
          notUpToDates.push(
            `  Action '${usesDeclaration}' has a newer version available: '${versionToCompare}'.${
              lastFull || lastSingle ? ` You can also upgrade to '${lastSingle}' or '${lastFull}'.` : ""
            }`
          )
        }

        continue
      } else {
        notUpToDates.push(
          `  Action '${usesDeclaration}' could not be checked. You can check available versions yourself: https://github.com/${repo}/tags`
        )
        continue
      }
    }

    const versionToCompare = version.length === 2 ? lastSingle : lastFull

    if (versionToCompare !== version) {
      const latestVersions = [lastSingle, lastFull]
        .filter((v) => typeof v !== "undefined")
        .map((v) => `'${v}'`)
        .join(" or ")

      notUpToDates.push(`  Action '${usesDeclaration}' has a newer version available: ${latestVersions}.`)
    }
  }

  console.log(`Checked ${path} ${notUpToDates.length ? "✗" : "✓"}`)
  console.log(notUpToDates.join("\n"))
}
