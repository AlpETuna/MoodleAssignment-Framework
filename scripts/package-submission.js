#!/usr/bin/env node
/**
 * package-submission.js
 * Creates the final submission folder at Desktop/Monash/Assignments/{UNIT}_{ASSIGNMENT}
 * and copies all relevant files (scaffold + submission-ready).
 *
 * Usage:
 *   node scripts/package-submission.js --unit FIT1045 --name "Assignment_1" --workspace ./workspace/fit1045/assignment_1
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const fse  = require('fs-extra');

const OUTPUT_BASE = process.env.OUTPUT_BASE_DIR || 'C:/Users/alper/Desktop/Monash/Assignments';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

function slugify(str) {
  return str.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toUpperCase();
}

async function packageSubmission({ unitCode, assignmentName, workspaceDir }) {
  const folderName  = `${slugify(unitCode)}_${slugify(assignmentName)}`;
  const outputDir   = path.join(OUTPUT_BASE, folderName);
  const scaffoldDir = path.join(outputDir, 'scaffold');
  const submitDir   = path.join(outputDir, 'submission');
  const srcDir      = path.join(outputDir, 'src');

  fse.mkdirpSync(scaffoldDir);
  fse.mkdirpSync(submitDir);
  fse.mkdirpSync(srcDir);

  console.log(`\nPackaging: ${folderName}`);
  console.log(`Source:    ${workspaceDir}`);
  console.log(`Output:    ${outputDir}`);

  if (!fs.existsSync(workspaceDir)) {
    console.error(`ERROR: Workspace directory not found: ${workspaceDir}`);
    process.exit(1);
  }

  const allFiles = getAllFiles(workspaceDir);

  const submissionFiles = [];
  const scaffoldFiles   = [];
  const sourceFiles     = [];

  for (const file of allFiles) {
    const rel      = path.relative(workspaceDir, file);
    const ext      = path.extname(file).toLowerCase();
    const basename = path.basename(file).toLowerCase();

    // Categorise files
    if (rel.startsWith('submission' + path.sep) || rel.startsWith('submission/')) {
      // Files explicitly in submission folder
      const dest = path.join(submitDir, path.basename(file));
      fse.copySync(file, dest);
      submissionFiles.push(dest);
    } else if (
      ext === '.pdf' ||
      basename.includes('report') ||
      basename.includes('submit') ||
      basename === 'done.json'
    ) {
      fse.copySync(file, path.join(submitDir, path.basename(file)));
      submissionFiles.push(path.join(submitDir, path.basename(file)));
    } else if (
      basename === 'assignment_brief.txt' ||
      basename.includes('scaffold') ||
      basename.includes('starter') ||
      basename.includes('template')
    ) {
      fse.copySync(file, path.join(scaffoldDir, path.basename(file)));
      scaffoldFiles.push(path.join(scaffoldDir, path.basename(file)));
    } else if (
      ['.py', '.java', '.cpp', '.c', '.js', '.ts', '.r', '.m', '.tex'].includes(ext)
    ) {
      const destRel = rel.startsWith('src' + path.sep) ? rel.slice(4) : rel;
      const dest = path.join(srcDir, destRel);
      fse.mkdirpSync(path.dirname(dest));
      fse.copySync(file, dest);
      sourceFiles.push(dest);
    } else {
      // Copy everything else to scaffold
      fse.copySync(file, path.join(scaffoldDir, rel));
    }
  }

  // Write README
  const readme = `# ${unitCode} — ${assignmentName}

## Folder Structure
- \`scaffold/\`   — Original assignment brief and starter files
- \`src/\`        — All source code
- \`submission/\` — Final submission-ready files (upload these)

## Submission Files
${submissionFiles.map(f => `- ${path.basename(f)}`).join('\n') || '- (none yet)'}

## Source Files
${sourceFiles.map(f => `- ${path.relative(outputDir, f)}`).join('\n') || '- (none yet)'}

Generated: ${new Date().toISOString()}
`;
  fs.writeFileSync(path.join(outputDir, 'README.md'), readme);

  const summary = {
    outputDir,
    folderName,
    unitCode,
    assignmentName,
    submissionFiles: submissionFiles.map(f => path.basename(f)),
    sourceFiles:     sourceFiles.map(f => path.relative(outputDir, f)),
    scaffoldFiles:   scaffoldFiles.map(f => path.basename(f)),
    readyForSubmission: submissionFiles.length > 0,
    packagedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outputDir, 'package-summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== PACKAGING COMPLETE ===');
  console.log(`Output folder:  ${outputDir}`);
  console.log(`Submission files: ${submissionFiles.length}`);
  console.log(`Source files: ${sourceFiles.length}`);
  console.log(`Ready for submission: ${summary.readyForSubmission ? 'YES ✓' : 'NO — check submission/ folder'}`);
  console.log('=========================\n');

  console.log(JSON.stringify(summary));
  return summary;
}

function getAllFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

// CLI usage
const args = parseArgs();
if (args.unit && args.name && args.workspace) {
  packageSubmission({
    unitCode:       args.unit,
    assignmentName: args.name,
    workspaceDir:   args.workspace,
  }).catch(console.error);
} else if (process.argv[1] === __filename && !process.env.IMPORTED) {
  console.log('Usage: node package-submission.js --unit FIT1045 --name "Assignment 1" --workspace ./workspace/fit1045/ass1');
}

module.exports = { packageSubmission };
