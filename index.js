/* eslint-disable no-constant-condition */
const puppeteer = require("puppeteer");
const sendgrid = require("@sendgrid/mail");
const dotenv = require("dotenv");

dotenv.config();

// Secrets
const USERNAME = process.env.SITE_USERNAME;
const PASSWORD = process.env.SITE_PASSWORD;
const EMAIL_TO = process.env.EMAIL_TO;
const EMAIL_FROM = process.env.EMAIL_FROM;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

sendgrid.setApiKey(SENDGRID_API_KEY);

// Config
const NUM_TABS = 3;
const NUM_ATTEMPTS = 2; // Set to -1 to attempt indefinitely
const ACTUALLY_SEND_EMAIL = false;

// Global vars
let SUCCESS = false;
let SUCCESS_PAGE = "";
let EMAIL_SENT = false;

// Constants
const GOTO_OPTIONS = {
  waitUntil: "networkidle2",
};

const URLS = {
  LANG_ENGLISH: "https://prenotami.esteri.it/Language/ChangeLanguage?lang=2",
  LOGIN: "https://prenotami.esteri.it/Home?ReturnUrl=%2fServices",
  LANDING: "https://prenotami.esteri.it/UserArea",
  BOOKING: "https://prenotami.esteri.it/Services/Booking/492", //489 is real URL
};

const SELECTORS = {
  LOGIN_EMAIL: "#login-email",
  LOGIN_PASS: "#login-password",
  LOGIN_BUTTON: "#login-form > button",
  NO_APPT_CONFIRM_BUTTON:
    "body > div.jconfirm.jconfirm-light.jconfirm-open > div.jconfirm-scrollpane > div > div > div > div > div > div > div > div.jconfirm-buttons",
};

function info(message, pageName = undefined) {
  const timestamp = new Date(Date.now()).toTimeString().slice(0, 8);
  console.info(`${timestamp}: ${pageName ? `${pageName} - ` : ""}${message}`);
}

async function createTabs(browser) {
  const pagePromises = [];

  for (let i = 0; i < NUM_TABS; ++i) {
    info(`Creating Promise for page #${i}...`);
    pagePromises.push(browser.newPage());
  }

  info(`All page Promises created. Awaiting Promise resolution...`);
  await Promise.all(pagePromises);
  info(`All page Promises resolved.`);

  const pages = [];
  let i = 0;
  for (const pagePromise of pagePromises) {
    info(`Awaiting page #${i} creation from Promise...`);
    const page = await pagePromise;
    info(`Page #${i} created from Promise.`);
    i++;
    page.setDefaultNavigationTimeout(0);
    pages.push({ page, name: `page${i}` });
  }

  info(`All pages created from Promises.`);
  return pages;
}

async function checkUrl({ page, name }, url) {
  info(`Awaiting page URL to compare against ${url}...`, name);
  const result = await page.url();
  info(
    `Page URL resolved: Current URL is ${
      result === url ? "equal" : "not equal"
    } to ${url}`,
    name
  );
  return result === url;
}

async function tryLogin(pages) {
  const { LOGIN, LANDING } = URLS;
  const { LOGIN_EMAIL, LOGIN_PASS, LOGIN_BUTTON } = SELECTORS;
  const { page, name } = pages[0];

  await page.bringToFront();
  while (true) {
    info(`Navigating to login page...`, name);
    await page.goto(LOGIN, GOTO_OPTIONS);
    if (await checkUrl({ page, name }, LANDING)) return;
    info(`No saved login session. Attempting login...`, name);
    await page.type(LOGIN_EMAIL, USERNAME);
    await page.type(LOGIN_PASS, PASSWORD);
    info(`Clicking login button...`, name);
    await page.click(LOGIN_BUTTON);
    info(`Waiting for navigation to complete...`, name);
    await page.waitForNavigation(GOTO_OPTIONS);
    const maybeLoggedIn = await checkUrl({ page, name }, LANDING);
    if (maybeLoggedIn) {
      info(`Login successful. Beginning page actions.`);
      return;
    }
    info(`Login unsuccessful. Retrying...`, name);
  }
}

async function doInAllTabs(action, pages, message, name) {
  const promises = [];
  info(`Beginning ${message}...`);
  for (const page of pages) {
    promises.push(action(page));
  }

  await Promise.all(promises);
  info(`${name} : All Promises resolved. Action complete.`);
}

async function setLanguageToEnglish({ page, name }) {
  const { LANG_ENGLISH } = URLS;

  info(`Setting language to English...`, name);
  await page.goto(LANG_ENGLISH, GOTO_OPTIONS);
}

async function attemptToBook({ page, name }) {
  const { BOOKING } = URLS;

  let attempts = 0;
  while (true) {
    if (attempts >= NUM_ATTEMPTS) {
      info(`Maximum attempts reached. Closing page...`, name);
      await page.close();
      info(`Page successfully closed.`, name);
      return false;
    }

    if (SUCCESS) {
      info(`Booking site reached in ${SUCCESS_PAGE}; closing...`, name);
      await page.close();
      info(`Page successfully closed.`, name);
      return false;
    }

    if (NUM_ATTEMPTS >= 0) {
      info(`Booking attempt: ${attempts + 1}`, name);
      ++attempts;
    }

    info(`Awaiting navigation to booking URL...`, name);
    await page.goto(URLS.BOOKING, GOTO_OPTIONS);
    info(`Navigation attempt complete.`, name);

    if (SUCCESS) {
      info(`Booking site reached in ${SUCCESS_PAGE}; closing...`, name);
      await page.close();
      info(`Page successfully closed.`, name);
      return false;
    }

    if (await checkUrl({ page, name }, BOOKING)) {
      SUCCESS = true;
      SUCCESS_PAGE = name;
      info(`SUCCESS! Sending email...`, name);

      const email = {
        to: EMAIL_TO,
        from: EMAIL_FROM,
        subject: "ITALY SITE SCRIPT HAS REACHED BOOKING PAGE",
        text: "GO GO GO GO GO GO GO GO GO",
      };

      if (EMAIL_SENT) return true;

      try {
        if (ACTUALLY_SEND_EMAIL) {
          const response = await sendgrid.send(email);
          info(
            `Email sent! SendGrid Response:\n\r${JSON.stringify(
              response,
              undefined,
              "\t"
            )}`,
            name
          );
          info(`Standing by...`, name);
        }
        EMAIL_SENT = true;
      } catch (error) {
        info(error, name);
        if (error.response) {
          info(JSON.stringify(error.response.body, undefined, "\t"), name);
        }
      }

      return true;
    }

    info(`Booking attempt failed. Retrying...`, name);
  }
}

async function startScript() {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { isLandscape: true, width: 1920, height: 1080 },
  });
  const tabs = await createTabs(browser);

  await tryLogin(tabs);
  await doInAllTabs(
    setLanguageToEnglish,
    tabs,
    "setting language to English in all tabs",
    "setLanguageToEnglish"
  );
  await doInAllTabs(
    attemptToBook,
    tabs,
    "booking attempts in all tabs",
    "attemptToBook"
  );

  info(`All page Promises resolved. Exit browser manually to end script...`);
}

startScript().catch((error) => console.log(error));
