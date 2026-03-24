#!/usr/bin/env node
const { execSync } = require("child_process");
const { confirm } = require("@inquirer/prompts");
const select = require("@inquirer/select").default;
const { Command, Option } = require("commander");
const ora = require("ora");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const https = require("https");
const CLI_VERSION = require("./package.json").version;

const { downloadFile, unzip } = require("./lib/download.js");

const program = new Command();

program
  .name("Create Radfish App")
  .description("The CLI to bootstrap a radfish app!")
  .version(CLI_VERSION);

let examples = [];

(async function run(argsv) {
  examples = await getExamples();

  await bootstrap(program);
  program.parse(argsv);
})(process.argv);

function getExamples() {
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(
      "https://api.github.com/repos/nmfs-ocio/radfish-monorepo/contents/examples",
    );
    const options = {
      hostname: requestUrl.hostname,
      path: requestUrl.pathname,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `radfish-cli/${CLI_VERSION}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    };
    https.get(options, function (response) {
      if (response.statusCode >= 400) {
        return reject(new Error("Failed to download file"));
      }

      if (response.statusCode === 200) {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });

        response.on("end", () => {
          const examples = JSON.parse(data);
          resolve(examples.filter((example) => example.type === "dir"));
        });
      }
    });
  });
}

async function bootstrap(program) {
  program
    .addOption(new Option("--template [name]", "specified template").choices(["react-javascript"]))
    .addOption(
      new Option("--example [name]", "specified example")
        .choices(examples.map((example) => example.name))
        .conflicts("template"),
    );

  // program options
  program.argument("<projectDirectoryPath>");

  program.action((projectDirectoryPath) => {
    scaffoldRadFishApp(projectDirectoryPath);
  });
}

async function selectExample(examples) {
  return await select({
    message: "Select an example",
    choices: examples.map((example) => ({ name: example.name, value: example.name })),
  });
}

async function scaffoldRadFishApp(projectDirectoryPath) {
  const targetDirectory = `${projectDirectoryPath.trim().replace(/\s+/g, "-")}`; // replace whitespaces in the filepath
  const targetDirectoryPath = path.resolve(process.cwd(), targetDirectory);

  async function confirmConfiguration() {
    return await confirm({
      message: `You are about to scaffold an application in the following project directory: ${targetDirectoryPath}
    Okay to proceed?`,
    });
  }

  async function bootstrapApp(options) {
    const spinner = ora("Setting up application").start();
    const ref = "latest";

    try {
      const temporaryDirectoryPath = await new Promise((resolve, reject) => {
        fs.mkdtemp(path.join(os.tmpdir(), "radfish-"), (err, folder) => {
          if (err) {
            return reject(err);
          }
          resolve(folder);
        });
      });

      const uuid = crypto.createHash("sha256").update(crypto.randomBytes(255)).digest("hex");
      const tarballFileName = `${uuid}.tar.gz`;
      const tarballFilePath = path.join(temporaryDirectoryPath, tarballFileName);

      await new Promise((resolve, reject) => {
        downloadFile(
          `https://api.github.com/repos/nmfs-ocio/radfish-monorepo/tarball/${encodeURIComponent(
            ref,
          )}`,
          tarballFilePath,
          (err, res) => {
            if (err) {
              return reject(err);
            }
            resolve(res);
          },
        );
      });

      await new Promise((resolve, reject) => {
        fs.mkdir(targetDirectoryPath, (err) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });

      let sourceType = "templates";
      let sourceProjectDirectory = "react-javascript";

      if (options.template) {
        sourceType = "templates";
        sourceProjectDirectory = options.template;
      } else if (options.example) {
        sourceType = "examples";
        sourceProjectDirectory = options.example;
      }

      const sourcePath = path.join(sourceType, sourceProjectDirectory);

      await new Promise((resolve, reject) => {
        unzip(
          tarballFilePath,
          { outputDirectoryPath: targetDirectoryPath, sourcePath: sourcePath },
          (err, res) => {
            if (err) {
              return reject(err);
            }
            resolve(res);
          },
        );
      });

      console.log(`\nProject successfully created.`);
    } catch (error) {
      console.error(error);
      console.error(`Error cloning repository: ${error.message}`);
      process.exit(1);
    }

    // Run an npm script (replace 'your-script-name' with the actual npm script name)
    try {
      execSync("npm install", { stdio: "inherit", cwd: targetDirectoryPath });
      console.log(`node modules successfully installed.`);
    } catch (error) {
      console.error(`Error running npm script: ${error.message}`);
      process.exit(1);
    }

    try {
      console.log(`Success! Created ${targetDirectory} at ${targetDirectoryPath}`);
      console.log(`\nWe suggest that you begin by typing:`);
      console.log(`  cd ${targetDirectory}`);
      console.log(`  npm start\n`);
      process.exit(0);
    } catch (error) {
      console.error(`Error running npm script: ${error.message}`);
      process.exit(1);
    }

    spinner.stop();
  }

  const options = program.opts();

  let example = options.example;
  if (example === true) {
    example = await selectExample(examples);
  }

  const confirmation = await confirmConfiguration();

  if (confirmation) {
    await bootstrapApp({ ...options, example });
  }
}
