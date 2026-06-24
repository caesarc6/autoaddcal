import type { Cookie, Page } from "playwright";
import path from "node:path";
import { config } from "../config.js";
import type { WpsApiResponse, WpsCalendarData, WpsStaffInfo } from "../types/index.js";
import {
  applyCalendarStaffId,
  getStaffInfo,
  resolveCalendarStaffId,
  staffInfoToContext,
  type WpsSession,
} from "./wps-client.js";

const LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

const WPS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

function unwrapResult<T>(data: unknown): WpsApiResponse<T> | null {
  if (!data || typeof data !== "object") return null;

  const obj = data as Record<string, unknown>;
  const topErrInfo =
    "errInfo" in obj && obj.errInfo && typeof obj.errInfo === "object"
      ? (obj.errInfo as WpsApiResponse<T>["errInfo"])
      : undefined;

  if ("res" in obj && obj.res && typeof obj.res === "object") {
    const res = obj.res as Record<string, unknown>;
    if (res.result && typeof res.result === "object") {
      const inner = res.result as Record<string, unknown>;
      if ("data" in inner) {
        return {
          data: inner.data as T,
          errInfo: (inner.errInfo as WpsApiResponse<T>["errInfo"]) ?? topErrInfo ?? { status: 0, errCode: null },
        };
      }
    }
    if ("data" in res) {
      return {
        data: res.data as T,
        errInfo: (res.errInfo as WpsApiResponse<T>["errInfo"]) ?? topErrInfo ?? { status: 0, errCode: null },
      };
    }
  }

  if (obj.result && typeof obj.result === "object") {
    const inner = obj.result as Record<string, unknown>;
    if ("data" in inner) {
      return {
        data: inner.data as T,
        errInfo: (inner.errInfo as WpsApiResponse<T>["errInfo"]) ?? topErrInfo ?? { status: 0, errCode: null },
      };
    }
    if ("staffId" in inner || "employeeNumber" in inner) {
      return {
        data: inner as T,
        errInfo: topErrInfo ?? { status: 0, errCode: null },
      };
    }
  }

  if ("data" in obj) {
    return {
      data: obj.data as T,
      errInfo: topErrInfo ?? (obj.errInfo as WpsApiResponse<T>["errInfo"]) ?? { status: 0, errCode: null },
    };
  }

  if ("staffId" in obj || "employeeNumber" in obj) {
    return {
      data: obj as T,
      errInfo: topErrInfo ?? { status: 0, errCode: null },
    };
  }

  return null;
}

function parseStaffInfo(data: unknown): WpsStaffInfo | null {
  const result = unwrapResult<WpsStaffInfo>(data);
  if (result?.data?.staffId) return result.data;
  return null;
}

async function completeAdfsPasswordLogin(
  page: Page,
  employeeNumber: string,
  password: string,
): Promise<void> {
  const userAccount = page.getByRole("textbox", { name: "User Account" });
  const nextBtn = page.getByRole("button", { name: "Next" });
  const passwordOption = page.getByRole("button", { name: "Password", exact: true });
  const passwordInput = page.getByRole("textbox", { name: "Password" });
  const signInBtn = page.getByRole("button", { name: "Sign in" });

  await userAccount.waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS });
  await userAccount.fill(employeeNumber);
  await nextBtn.click();

  await passwordOption.waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS });
  await passwordOption.click();

  await passwordInput.waitFor({ state: "visible", timeout: LOGIN_TIMEOUT_MS });
  await passwordInput.fill(password);
  await signInBtn.click();
}

function adfsLoginFailureMessage(bodyText: string): string | null {
  const text = bodyText.toLowerCase();

  if (
    text.includes("incorrect user id or password") ||
    text.includes("incorrect username or password")
  ) {
    return "Sign-in failed — incorrect employee ID or password";
  }
  if (text.includes("account has been locked") || text.includes("account is locked")) {
    return "Sign-in failed — account is locked";
  }
  if (
    text.includes("verify your identity") ||
    text.includes("multi-factor") ||
    text.includes("authenticator app") ||
    text.includes("verification code") ||
    text.includes("enter the code")
  ) {
    return "Sign-in requires MFA, which this tool cannot automate";
  }
  if (text.includes("sign in using a certificate") && text.includes("authentication options")) {
    return null;
  }

  return null;
}

async function dismissAdfsPrompts(page: Page): Promise<boolean> {
  const staySignedInYes = page.locator("#idSIButton9");
  if (await staySignedInYes.isVisible().catch(() => false)) {
    await staySignedInYes.click();
    return true;
  }

  const staySignedInNo = page.locator("#idBtn_Back");
  if (await staySignedInNo.isVisible().catch(() => false)) {
    await staySignedInNo.click();
    return true;
  }

  const kmsiSubmit = page.locator('input[type="submit"][value="Yes"], input[type="submit"][value="No"]');
  if (await kmsiSubmit.first().isVisible().catch(() => false)) {
    await kmsiSubmit.first().click();
    return true;
  }

  return false;
}

async function submitWpsNativeLoginForm(
  page: Page,
  employeeNumber: string,
  password: string,
): Promise<boolean> {
  const uid = page.locator("#uid");
  const pwd = page.locator("#pwd");
  if (!(await uid.isVisible().catch(() => false))) {
    return false;
  }

  await uid.fill(employeeNumber);
  await pwd.fill(password);
  await page.locator('button[name="login"], .login-button button').first().click();
  return true;
}

function hasWpsOAuthCode(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes("wps.fastretailing.com") &&
      parsed.searchParams.has("code")
    );
  } catch {
    return false;
  }
}

function isWpsTimelineUrl(url: string): boolean {
  return url.includes("wps.fastretailing.com") && url.includes("/timeline");
}

async function waitForLoginResponse(
  page: Page,
  timeoutMs: number,
): Promise<{ status: number; result: WpsApiResponse<{ staffId: number }> | null } | null> {
  const loginResponse = await page
    .waitForResponse(
      (r) => r.url().includes("/account/login") && r.request().method() === "POST",
      { timeout: timeoutMs },
    )
    .catch(() => null);

  if (!loginResponse) return null;

  const status = loginResponse.status();
  let result: WpsApiResponse<{ staffId: number }> | null = null;
  try {
    result = unwrapResult<{ staffId: number }>(await loginResponse.json());
  } catch {
    // Response may not be JSON
  }

  return { status, result };
}

function loginErrorMessage(
  result: WpsApiResponse<{ staffId: number }> | null,
  httpStatus?: number,
): string {
  const code = result?.errInfo?.errCode;
  if (code === "S9001") {
    return "Server error during sign-in (S9001). Try again in a moment.";
  }
  if (code) return `Sign-in failed (${code})`;
  if (httpStatus && httpStatus >= 500) {
    return `Server error (HTTP ${httpStatus})`;
  }
  if (httpStatus && httpStatus >= 400) {
    return `Sign-in failed (HTTP ${httpStatus})`;
  }
  return "Incorrect employee ID or password";
}

async function waitForTimeline(page: Page): Promise<void> {
  await page.goto(`${config.wpsBaseUrl}/timeline`, {
    waitUntil: "networkidle",
    timeout: LOGIN_TIMEOUT_MS,
  });
}

async function waitForWpsOAuthExchange(
  page: Page,
  employeeNumber: string,
  password: string,
): Promise<void> {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const url = page.url();

    if (hasWpsOAuthCode(url)) {
      await page.waitForLoadState("domcontentloaded");

      let loginResult = await waitForLoginResponse(page, 15_000);
      if (!loginResult) {
        await submitWpsNativeLoginForm(page, employeeNumber, password);
        loginResult = await waitForLoginResponse(page, 15_000);
      }

      if (loginResult?.result?.errInfo?.status === 0 && loginResult.result.data?.staffId) {
        await waitForTimeline(page).catch(() => undefined);
        return;
      }

      if (loginResult && loginResult.status >= 400) {
        throw new Error(loginErrorMessage(loginResult.result, loginResult.status));
      }

      await waitForTimeline(page);
      return;
    }

    if (isWpsTimelineUrl(url)) {
      return;
    }

    if (url.includes("sts") || url.includes("adfs")) {
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const failure = adfsLoginFailureMessage(bodyText);
      if (failure) {
        throw new Error(failure);
      }

      if (await dismissAdfsPrompts(page)) {
        continue;
      }
    }

    await page.waitForTimeout(500);
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const failure = adfsLoginFailureMessage(bodyText);
  if (failure) {
    throw new Error(failure);
  }

  if (page.url().includes("sts") || page.url().includes("adfs")) {
    throw new Error(
      "Sign-in timed out on the corporate sign-in page. Check your employee ID and password, or your account may require MFA or certificate login.",
    );
  }

  throw new Error("Sign-in timed out waiting for session");
}

function cookiesToHeader(cookies: Cookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function staffFromCookies(cookies: Cookie[], employeeNumber: string): Partial<WpsStaffInfo> {
  const map = Object.fromEntries(cookies.map((c) => [c.name, c.value]));
  return {
    staffId: map.STA ? Number(map.STA) : 0,
    storeId: map.STR ? Number(map.STR) : 0,
    employeeNumber: employeeNumber,
    employeeName: "",
    storeName: "",
    storeCode: "",
    countryCode: "",
  };
}

function currentMonthKey(): string {
  const month = new Date();
  return `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-01 00:00:00`;
}

async function fetchStaffViaBrowserRequest(page: Page): Promise<WpsStaffInfo | null> {
  try {
    const response = await page.request.post(`${config.wpsBaseUrl}/account/info`, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        Origin: config.wpsBaseUrl,
        Referer: `${config.wpsBaseUrl}/timeline`,
      },
      data: {},
    });
    if (!response.ok()) return null;
    return parseStaffInfo(await response.json());
  } catch {
    return null;
  }
}

async function fetchCalendarViaBrowserRequest(
  page: Page,
  staffId: number,
  storeId: number,
  countryCode: string,
): Promise<WpsCalendarData | null> {
  try {
    const response = await page.request.post(`${config.wpsBaseUrl}/api/Calendar`, {
      headers: {
        "Content-Type": "application/json;charset=UTF-8",
        Accept: "application/json, text/plain, */*",
        Origin: config.wpsBaseUrl,
        Referer: `${config.wpsBaseUrl}/calendar`,
      },
      data: {
        month: currentMonthKey(),
        staffId,
        storeId,
        countryCode,
      },
    });
    if (!response.ok()) return null;
    return unwrapResult<WpsCalendarData>(await response.json())?.data ?? null;
  } catch {
    return null;
  }
}

async function buildSessionFromPage(
  page: Page,
  employeeNumber: string,
): Promise<WpsSession> {
  const cookies = await page.context().cookies();
  const cookieHeader = cookiesToHeader(cookies);
  const fallback = staffFromCookies(cookies, employeeNumber);

  if (!fallback.staffId) {
    throw new Error("Sign-in failed — no session after sign-in");
  }

  let staff = await fetchStaffViaBrowserRequest(page);

  if (!staff?.staffId) {
    const calendar = await fetchCalendarViaBrowserRequest(
      page,
      fallback.staffId,
      fallback.storeId ?? 0,
      staff?.countryCode ?? "US",
    );
    if (calendar) {
      staff = {
        staffId: fallback.staffId,
        storeId: fallback.storeId ?? 0,
        employeeNumber,
        employeeName: calendar.staffName ?? "Employee",
        storeName: calendar.storeName ?? "Store",
        storeCode: "",
        countryCode: staff?.countryCode ?? "US",
      };
    }
  }

  if (!staff?.staffId) {
    staff = {
      employeeName: "Employee",
      storeName: "Store",
      storeCode: "",
      countryCode: "US",
      ...fallback,
    } as WpsStaffInfo;

    try {
      staff = await getStaffInfo(cookieHeader);
    } catch {
      // cookie-based fallback is enough to proceed
    }
  }

  const calendarStaffId = await resolveCalendarStaffId(
    cookieHeader,
    staff.employeeNumber || employeeNumber,
  );
  staff = applyCalendarStaffId(staff, cookieHeader, calendarStaffId);

  const context = staffInfoToContext(cookieHeader, staff);
  return {
    cookieHeader,
    employeeNumber: staff.employeeNumber || employeeNumber,
    staffName: staff.employeeName || "Employee",
    storeName: staff.storeName || "Store",
    context,
  };
}

async function launchBrowser() {
  if (process.env.VERCEL) {
    const { chromium: pwChromium } = await import("playwright-core");
    const chromium = (await import("@sparticuz/chromium")).default;
    const executablePath = await chromium.executablePath();
    process.env.LD_LIBRARY_PATH = path.dirname(executablePath);

    return pwChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    });
  }

  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

export async function loginWithCredentials(
  employeeNumber: string,
  password: string,
): Promise<WpsSession> {
  const browser = await launchBrowser();
  const context = await browser.newContext({ userAgent: WPS_USER_AGENT });
  const page = (await context.newPage()) as Page;

  try {
    await page.route("**/account/login", async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }

      let payload: Record<string, string> = {};
      try {
        payload = route.request().postDataJSON() as Record<string, string>;
      } catch {
        payload = {};
      }

      await route.continue({
        postData: JSON.stringify({
          ...payload,
          employeeNumber: payload.employeeNumber || employeeNumber,
        }),
      });
    });

    await page.goto(`${config.wpsBaseUrl}/login`, {
      waitUntil: "domcontentloaded",
      timeout: LOGIN_TIMEOUT_MS,
    });

    await page.waitForURL(/sts|adfs/, { timeout: LOGIN_TIMEOUT_MS });

    const oauthExchange = waitForWpsOAuthExchange(page, employeeNumber, password);
    await completeAdfsPasswordLogin(page, employeeNumber, password);
    await oauthExchange;

    return await buildSessionFromPage(page, employeeNumber);
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}
