#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');

let settings = null;

function start() {
  var args = process.argv.slice(2);

  if (args[0] === 'init') {
    createCalogenJsonFile();
    console.log('calogen.json file is created with default settings.');
    return;
  }

  try {
    settings = JSON.parse(fs.readFileSync('./calogen.json'));
  } catch (error) {
    console.error('Please call "calogen init" to create calogen.json file.');
    return;
  }

  switch (args[0]) {
    case 'a':
    case 'add':
      addNewLog();
      break;
    case 'g':
    case 'generate':
      generateChangelog();
      break;
    case 'p':
    case 'publish':
      const versionArgIndex = args.indexOf('-v') + 1;
      const version = args.slice(versionArgIndex).join(' ');
      if (versionArgIndex === 0 || !version) {
        console.error('Please provide version using -v argument.');
        return;
      }
      publishNewVersion(version);
      break;
    default:
      console.log('"a" or "add" to add new log.');
      console.log('"g" or "generate" to generate the CHANGELOG.md.');
      console.log('"p" or "publish" to publish a new version.');
  }

  function createCalogenJsonFile() {
    const defaultSettings = {
      logsFolderPath: './docs/changelogs',
      types: {
        b: 'bug-fix',
        f: 'feature',
      },
      defaultValues: {
        version: 'Next Release',
      },
    };
    fs.writeFileSync('./calogen.json', JSON.stringify(defaultSettings, undefined, 4));
  }

  async function addNewLog() {
    const username = getUsername();
    const filePath = `${settings.logsFolderPath}/${username}.json`;
    let userLogFile = '[]';
    try {
      userLogFile = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' });
    } catch (error) {}
    let userLogs = JSON.parse(userLogFile);
    if (!Array.isArray(userLogs)) {
      throw 'User log file must contain array of logs.';
    }
    const userLog = await getLogInfoFromUserInput();
    userLogs.push(userLog);
    fs.writeFileSync(filePath, JSON.stringify(userLogs, undefined, 4));
    console.log('Log file created.');
    console.log(filePath);
    try {
      exec('code ' + filePath);
    } catch (err) {}
  }
}

async function getLogInfoFromUserInput() {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const type = await getUserInput(readline, `type(${JSON.stringify(settings.types).replace(/['"{}]+/g, '')}): `);
  const isBreakingChange = (await getUserInput(readline, 'is breaking change? y/n(default): ') || 'n') === 'y';
  const title = await getUserInput(readline, 'title: ');
  const description = await getUserInput(readline, 'description: ');
  const bugNo = await getUserInput(readline, 'PBI no: ');
  const bugLink = await getUserInput(readline, 'PBI link: ');
  readline.close();
  return { type, isBreakingChange, title, description, bugNo, bugLink };
}

function getUserInput(readline, text) {
  return new Promise((res, rej) => {
    readline.question(text, (input) => {
      res(input);
    });
  });
}

function generateChangelog() {
  fs.readdir(settings.logsFolderPath, { withFileTypes: true }, (err, files) => {
    if (err) console.error(err);
    else {
      const logsByVersion = {};
      const oncomingLogs = [];
      files.forEach((file) => {
        const filenameSplit = file.name.split('.');
        if (!file.isFile || filenameSplit[filenameSplit.length - 1] !== 'json') return;

        const userLogs = JSON.parse(fs.readFileSync(settings.logsFolderPath + '/' + file.name, { encoding: 'utf8', flag: 'r' }));
        userLogs.forEach((ul) => {
          if (ul.version === undefined || ul.version === null) {
            oncomingLogs.push(ul);
          } else {
            logsByVersion[ul.version] = logsByVersion[ul.version] ?? [];
            logsByVersion[ul.version].push(ul);
          }
        });
      });
      const versions = Object.keys(logsByVersion).map((version) => ({ version, logs: logsByVersion[version] }));
      versions.sort((a, b) => (b.version.toUpperCase() > a.version.toUpperCase() ? 1 : -1)); // sort alphabetically
      versions.splice(0, 0, { version: 'oncoming', logs: oncomingLogs });
      const template = fs.readFileSync(settings.logsFolderPath + '/template.md', { encoding: 'utf8', flag: 'r' });
      const changelog = parseVersions(versions, template);
      fs.writeFileSync(settings.logsFolderPath + '/../CHANGELOG.md', changelog);
      console.log('Generated CHANGELOG.md');
    }
    return;
  });
}

function parseVersions(versions, template) {
  let breakingChangesHeaderTemp = getTemplatePart(template, 'BREAKINGCHANGESHEADER');
  let breakingChangesLogTemp = getTemplatePart(template, 'BREAKINGCHANGESLOG');
  let headerTemp = getTemplatePart(template, 'HEADER');
  let logHeaderTemp = getTemplatePart(template, 'LOGHEADER');
  let logTemp = getTemplatePart(template, 'LOG');
  let footerTemp = getTemplatePart(template, 'FOOTER');

  let changelogArray = [];

  versions.forEach((v) => {
    const headerKeyValues = [];
    if (v.version && v.version !== 'oncoming') {
      headerKeyValues.push({ key: 'version', value: v.version });
    }
    const header = applyValues(headerTemp, headerKeyValues);
    changelogArray.push(header);
    const versionBreakingChangeLogs = [];
    v.logs
      .filter((l) => l.isBreakingChange)
      .forEach((log) => {
        const logKeyValues = [];
        logKeyValues.push({ key: 'title', value: log.title });
        logKeyValues.push({ key: 'description', value: log.description });
        const logStr = applyValues(breakingChangesLogTemp, logKeyValues);
        versionBreakingChangeLogs.push(logStr);
      });
    const versionLogs = [];
    v.logs
      .filter((l) => !l.isBreakingChange)
      .forEach((log) => {
        const logKeyValues = [];
        logKeyValues.push({ key: 'type', value: settings.types[log.type] });
        logKeyValues.push({ key: 'title', value: log.title });
        logKeyValues.push({ key: 'description', value: log.description });
        logKeyValues.push({ key: 'bugNo', value: log.bugNo });
        logKeyValues.push({ key: 'bugLink', value: log.bugLink });
        const logStr = applyValues(logTemp, logKeyValues);
        versionLogs.push(logStr);
      });
    if (versionBreakingChangeLogs.length) {
      changelogArray.push(applyValues(breakingChangesHeaderTemp, null));
      versionBreakingChangeLogs.sort((a, b) => a.localeCompare(b));
      changelogArray = changelogArray.concat(versionBreakingChangeLogs);
    }
    const logHeader = applyValues(logHeaderTemp, null);
    changelogArray.push(logHeader);
    versionLogs.sort((a, b) => a.localeCompare(b));
    changelogArray = changelogArray.concat(versionLogs);
    const footer = applyValues(footerTemp, null);
    changelogArray.push(footer);
  });
  return changelogArray.join('');
}

function applyValues(template, keyValues) {
  keyValues?.forEach((kv) => {
    if (kv.value !== undefined || kv.value !== null) template = replaceAll(template, `{{${kv.key}}}`, kv.value);
  });
  Object.keys(settings.defaultValues).forEach((defaultKey) => {
    template = replaceAll(template, `{{${defaultKey}}}`, settings.defaultValues[defaultKey]);
  });
  return template;
}

function replaceAll(str, match, replacement) {
  return str.split(match).join(replacement);
}

function getTemplatePart(template, partName) {
  const indexStart = template.indexOf(`{{${partName}}}`) + partName.length + 4;
  const indexEnd = template.indexOf(`{{/${partName}}}`);
  return template.substring(indexStart, indexEnd);
}

function getUsername() {
  const usernameOs = require('os').userInfo().username;
  var path = require('path');
  const userNameEnv = process.env['USERPROFILE'].split(path.sep)[2];
  return usernameOs || userNameEnv;
}

function publishNewVersion(version) {
  fs.readdir(settings.logsFolderPath, { withFileTypes: true }, (err, files) => {
    if (err) console.error(err);
    else {
      files.forEach((file) => {
        const filenameSplit = file.name.split('.');
        if (!file.isFile || filenameSplit[filenameSplit.length - 1] !== 'json') return;
        const filePath = settings.logsFolderPath + '/' + file.name;
        const userLogs = JSON.parse(fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }));
        userLogs.forEach((ul) => {
          if (!ul.version) {
            ul.version = version;
          }
        });
        fs.writeFileSync(filePath, JSON.stringify(userLogs, undefined, 4));
      });
    }
    generateChangelog();
  });
}

start();
