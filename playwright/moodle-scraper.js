#!/usr/bin/env node
/**
 * Monash Moodle Scraper
 * Authenticates via Monash SSO + Duo MFA (number matching),
 * scrapes upcoming assignments, and downloads all attached files.
 *
 * Usage:
 *   node moodle-scraper.js              # list + download all upcoming
 *   node moodle-scraper.js --list-only  # print JSON list, no download
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { chromium } = require('playwright');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const readline = require('readline');

const MOODLE_URL = process.env.MOODLE_URL || 'https://moodle.vle.monash.edu';
const USERNAME   = process.env.MOODLE_USERNAME;
const PASSWORD   = process.env.MOODLE_PASSWORD;
const WORKSPACE  = process.env.WORKSPACE_DIR || path.join(__dirname, '../workspace');
const LIST_ONLY  = process.argv.includes('--list-only');

if (!USERNAME || !PASSWORD) {
  console.error('ERROR: Set MOODLE_USERNAME and MOODLE_PASSWORD in .env');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function askQuestion(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); }));
}

function slugify(str) {
  return str.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toLowerCase();
}

async function waitForNavigation(page, timeout = 15000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch {
    await page.waitForLoadState('domcontentloaded', { timeout });
  }
}

// ─────────────────────────────────────────────────────────────
// Authentication
// ─────────────────────────────────────────────────────────────

async function authenticate(page) {
  console.error('[auth] Navigating to Moodle...');
  await page.goto(MOODLE_URL, { waitUntil: 'domcontentloaded' });

  // Click the SSO / "Log in" button (Moodle → Monash SSO)
  const loginBtn = page.locator('a.btn-sso, a[href*="sso"], a:has-text("Log in with Monash"), a:has-text("Login")').first();
  await loginBtn.waitFor({ timeout: 10000 });
  await loginBtn.click();
  await waitForNavigation(page);

  // ── Monash SSO login form ──
  const urlNow = page.url();
  if (urlNow.includes('sso.monash.edu') || urlNow.includes('adfs') || urlNow.includes('login')) {
    console.error('[auth] On SSO page, entering credentials...');

    // Username field (may be email or studentID)
    const userField = page.locator('input[type="email"], input[name="username"], input[id="userNameInput"], input[name="loginfmt"]').first();
    await userField.waitFor({ timeout: 8000 });
    await userField.fill(USERNAME);

    // Some SSO pages require clicking Next before password
    const nextBtn = page.locator('input[type="submit"][value*="Next"], button:has-text("Next")');
    if (await nextBtn.count() > 0) {
      await nextBtn.first().click();
      await waitForNavigation(page);
    }

    const passField = page.locator('input[type="password"], input[name="password"], input[id="passwordInput"]').first();
    await passField.waitFor({ timeout: 8000 });
    await passField.fill(PASSWORD);

    const submitBtn = page.locator('input[type="submit"], button[type="submit"], button:has-text("Sign in")').first();
    await submitBtn.click();
    await waitForNavigation(page);
  }

  // ── Duo MFA (number matching) ──
  const currentUrl = page.url();
  if (currentUrl.includes('duo') || currentUrl.includes('mfa') || await page.locator('[data-testid="duo-code"]').count() > 0) {
    await handleDuoMFA(page);
  } else {
    // Duo often loads in an iframe
    const duoFrame = page.frameLocator('iframe[src*="duo"]');
    try {
      const duoCode = duoFrame.locator('.verification-code, [data-testid="verification-code"], .passcode');
      await duoCode.waitFor({ timeout: 8000 });
      await handleDuoMFAInFrame(page, duoFrame);
    } catch {
      // Try waiting for direct Duo push page
      try {
        await page.waitForSelector('.verification-code, [data-testid="duo-number"]', { timeout: 5000 });
        await handleDuoMFA(page);
      } catch {
        console.error('[auth] MFA step not detected — may already be logged in or MFA was skipped');
      }
    }
  }

  // Wait until we're back on Moodle dashboard
  await page.waitForURL(`${MOODLE_URL}/**`, { timeout: 60000 }).catch(() => {});
  console.error('[auth] Authentication complete. URL:', page.url());
}

async function handleDuoMFA(page) {
  // Monash uses Duo with "number matching" — a code is shown in the browser
  // User must tap that exact number in the Duo app
  console.error('[duo] Waiting for Duo number-matching code to appear...');

  let code = null;
  for (let i = 0; i < 20; i++) {
    const codeEl = await page.$('.verification-code, [data-testid="verification-code"], #duo-code, .number-match-code');
    if (codeEl) {
      code = await codeEl.textContent();
      code = code.trim();
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (code) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`   DUO MFA — Enter this number in the Duo app:`);
    console.log(`\n               [ ${code} ]\n`);
    console.log(`${'='.repeat(50)}\n`);
    // n8n will capture this stdout; also wait for human to confirm
    await askQuestion('Press ENTER after you have approved the Duo push...');
  } else {
    // Code not found — ask user to check their phone manually
    console.log('\n[duo] Could not auto-read the Duo code from the page.');
    await askQuestion('Please approve the Duo push on your phone, then press ENTER...');
  }

  // Wait for redirect after MFA
  await page.waitForLoadState('networkidle', { timeout: 60000 });
}

async function handleDuoMFAInFrame(page, duoFrame) {
  const codeEl = duoFrame.locator('.verification-code, .passcode').first();
  const code = await codeEl.textContent();
  console.log(`\n${'='.repeat(50)}`);
  console.log(`   DUO MFA — Enter this number in the Duo app:`);
  console.log(`\n               [ ${code.trim()} ]\n`);
  console.log(`${'='.repeat(50)}\n`);
  await askQuestion('Press ENTER after approving the Duo push...');
  await page.waitForLoadState('networkidle', { timeout: 60000 });
}

// ─────────────────────────────────────────────────────────────
// Assignment Scraping
// ─────────────────────────────────────────────────────────────

async function getAssignments(page) {
  console.error('[scrape] Fetching upcoming assignments...');

  // Go to the assignments / calendar overview page
  await page.goto(`${MOODLE_URL}/calendar/view.php?view=upcoming`, { waitUntil: 'domcontentloaded' });
  await waitForNavigation(page);

  const assignments = [];

  // Parse upcoming events from calendar
  const events = await page.$$('.event');
  for (const ev of events) {
    try {
      const titleEl = await ev.$('.name a, h3 a, .event-name a');
      const dateEl  = await ev.$('.date, time, .event-time');
      const courseEl = await ev.$('.course-name, .calendar_event_course');

      if (!titleEl) continue;

      const title    = (await titleEl.textContent()).trim();
      const href     = await titleEl.getAttribute('href');
      const dueDate  = dateEl ? (await dateEl.textContent()).trim() : 'Unknown';
      const course   = courseEl ? (await courseEl.textContent()).trim() : 'Unknown Course';

      if (href && (href.includes('assign') || href.includes('quiz') || href.includes('workshop'))) {
        assignments.push({ title, url: href, dueDate, course, type: 'assignment' });
      }
    } catch (e) {
      // Skip malformed events
    }
  }

  // Also check the dashboard timeline block
  await page.goto(`${MOODLE_URL}/my/`, { waitUntil: 'domcontentloaded' });
  await waitForNavigation(page);

  const timelineItems = await page.$$('[data-region="event-list-item"], .timeline-event, [data-action="view-event"]');
  for (const item of timelineItems) {
    try {
      const titleEl  = await item.$('a[data-action], .event-name a, h4 a');
      const dateEl   = await item.$('[data-region="event-date"], time, .date');
      const courseEl = await item.$('[data-region="course-name"], .course-name');

      if (!titleEl) continue;

      const title   = (await titleEl.textContent()).trim();
      const href    = await titleEl.getAttribute('href') || await item.getAttribute('data-url');
      const dueDate = dateEl ? (await dateEl.textContent()).trim() : 'Unknown';
      const course  = courseEl ? (await courseEl.textContent()).trim() : 'Unknown';

      if (title && href && !assignments.find(a => a.title === title)) {
        assignments.push({ title, url: href, dueDate, course, type: 'assignment' });
      }
    } catch {
      // skip
    }
  }

  console.error(`[scrape] Found ${assignments.length} upcoming assignment(s)`);
  return assignments;
}

async function getAssignmentDetails(page, assignment) {
  console.error(`[scrape] Getting details for: ${assignment.title}`);
  await page.goto(assignment.url, { waitUntil: 'domcontentloaded' });
  await waitForNavigation(page);

  // Extract unit code from page title or breadcrumb
  const breadcrumb = await page.$('.breadcrumb, nav[aria-label="breadcrumb"]');
  let unitCode = 'UNKNOWN';
  if (breadcrumb) {
    const crumbText = await breadcrumb.textContent();
    const match = crumbText.match(/\b([A-Z]{2,4}\d{4})\b/);
    if (match) unitCode = match[1];
  }
  if (unitCode === 'UNKNOWN') {
    const titleMatch = assignment.course.match(/\b([A-Z]{2,4}\d{4})\b/);
    if (titleMatch) unitCode = titleMatch[1];
  }

  // Extract description
  const descEl = await page.$('.activity-description, #intro, [data-region="assignment-info"]');
  const description = descEl ? (await descEl.innerText()).trim() : '';

  // Extract submission type / requirements
  const submissionType = await page.$eval(
    '.submissiontypetable, [data-region="submission-type"]',
    el => el.innerText
  ).catch(() => '');

  // Get due date from assignment page (more precise than calendar)
  const dueEl = await page.$('.submissionduedate, [data-region="due-date"], time[datetime]');
  const dueDate = dueEl ? (await dueEl.textContent()).trim() : assignment.dueDate;

  // Find all file attachments
  const fileLinks = await page.$$('a[href*="pluginfile"], a[href*="mod_resource"], a.aalink');
  const files = [];
  for (const link of fileLinks) {
    const href = await link.getAttribute('href');
    const name = (await link.textContent()).trim();
    if (href && href.includes('moodle')) {
      files.push({ name, url: href });
    }
  }

  return {
    ...assignment,
    unitCode,
    description,
    submissionType,
    dueDate,
    files,
    workspaceDir: null, // filled after download
  };
}

// ─────────────────────────────────────────────────────────────
// File Download
// ─────────────────────────────────────────────────────────────

async function downloadAssignmentFiles(page, assignment) {
  const safeName  = slugify(assignment.title);
  const unitSlug  = slugify(assignment.unitCode);
  const dir       = path.join(WORKSPACE, unitSlug, safeName);
  fse.mkdirpSync(dir);

  // Save description as text file
  fs.writeFileSync(path.join(dir, 'ASSIGNMENT_BRIEF.txt'),
    `Title: ${assignment.title}\nUnit: ${assignment.unitCode}\nDue: ${assignment.dueDate}\n\n${assignment.description}`
  );

  // Download each attached file
  const downloadedPaths = [];
  for (const file of assignment.files) {
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await page.goto(file.url);
      const download = await downloadPromise;
      const savePath = path.join(dir, download.suggestedFilename() || file.name);
      await download.saveAs(savePath);
      downloadedPaths.push(savePath);
      console.error(`[download] Saved: ${savePath}`);

      // Extract zip files automatically
      if (savePath.endsWith('.zip')) {
        const extract = require('child_process').execSync;
        try {
          extract(`unzip -o "${savePath}" -d "${dir}/extracted_${path.basename(savePath, '.zip')}"`, { stdio: 'pipe' });
        } catch {
          // unzip not available on Windows — note for user
        }
      }
    } catch (e) {
      console.error(`[download] Failed to download ${file.name}: ${e.message}`);
    }
  }

  assignment.workspaceDir = dir;
  assignment.downloadedFiles = downloadedPaths;
  return assignment;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({
    headless: false, // visible so user can see MFA prompt
    slowMo: 100,
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page    = await context.newPage();

  try {
    await authenticate(page);

    let assignments = await getAssignments(page);

    if (assignments.length === 0) {
      console.log(JSON.stringify({ assignments: [], message: 'No upcoming assignments found' }));
      process.exit(0);
    }

    const detailed = [];
    for (const a of assignments) {
      const details = await getAssignmentDetails(page, a);
      if (!LIST_ONLY) {
        await downloadAssignmentFiles(page, details);
      }
      detailed.push(details);
    }

    // Output JSON for n8n to consume
    console.log(JSON.stringify({ assignments: detailed, scrapedAt: new Date().toISOString() }));

  } catch (err) {
    console.error('[error]', err.message);
    console.log(JSON.stringify({ error: err.message, assignments: [] }));
  } finally {
    await browser.close();
  }
})();
