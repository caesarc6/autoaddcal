import { config } from "../config.js";
import type {
  WpsApiResponse,
  WpsCalendarData,
  WpsSessionContext,
  WpsStaffInfo,
  WpsStoredSession,
} from "../types/index.js";
import { decrypt } from "../utils/crypto.js";

export interface WpsSession {
  cookieHeader: string;
  employeeNumber: string;
  staffName: string;
  storeName: string;
  context: WpsSessionContext;
}

interface WpsCookie {
  name: string;
  value: string;
}

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
    // result may be the data payload directly
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

  // Bare staff payload
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

function describeUnexpectedResponse(data: unknown): string {
  if (!data || typeof data !== "object") {
    return typeof data === "string" ? data.slice(0, 200) : String(data);
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.message === "string") return obj.message;
  const keys = Object.keys(obj).slice(0, 8).join(", ");
  return keys ? `keys: ${keys}` : "empty object";
}

function requireResult<T>(
  data: unknown,
  context: string,
): WpsApiResponse<T> {
  const result = unwrapResult<T>(data);
  if (!result?.errInfo) {
    throw new Error(`${context} — unexpected response from schedule service (${describeUnexpectedResponse(data)})`);
  }
  return result;
}

function serializeStoredSession(session: WpsStoredSession): string {
  return JSON.stringify(session);
}

export function deserializeStoredSession(payload: string): WpsStoredSession {
  try {
    return JSON.parse(payload) as WpsStoredSession;
  } catch {
    // Legacy rows stored with an extra app-layer encrypt before Supabase migration.
    return JSON.parse(decrypt(payload)) as WpsStoredSession;
  }
}

function staffIdFromCookieHeader(cookieHeader: string): number | null {
  const match = cookieHeader.match(/(?:^|;\s*)STA=(\d+)/);
  if (!match) return null;
  const staffId = Number(match[1]);
  return Number.isFinite(staffId) && staffId > 0 ? staffId : null;
}

export async function resolveCalendarStaffId(
  cookieHeader: string,
  employeeNumber: string,
): Promise<number | null> {
  try {
    const data = await fetchJson<unknown>(
      "/api/TimeLine/GetStaffIdByEmployeeNumber",
      cookieHeader,
      { employeeNumber },
    );
    const result = unwrapResult<{ staffId: number }>(data);
    if (result?.errInfo.status === 0 && result.data.staffId) {
      return result.data.staffId;
    }
  } catch {
    // Timeline lookup may fail outside a browser session; fall back to STA cookie.
  }
  return staffIdFromCookieHeader(cookieHeader);
}

export function applyCalendarStaffId(
  staff: WpsStaffInfo,
  cookieHeader: string,
  calendarStaffId: number | null,
): WpsStaffInfo {
  if (calendarStaffId && calendarStaffId !== staff.staffId) {
    return { ...staff, staffId: calendarStaffId };
  }
  const cookieStaffId = staffIdFromCookieHeader(cookieHeader);
  if (cookieStaffId && cookieStaffId !== staff.staffId) {
    return { ...staff, staffId: cookieStaffId };
  }
  return staff;
}

export function staffInfoToContext(
  cookieHeader: string,
  staff: WpsStaffInfo,
): WpsSessionContext {
  return {
    cookieHeader,
    staffId: staff.staffId,
    storeId: staff.storeId,
    countryCode: staff.countryCode,
    country: staff.country ?? staff.countryCode.toLowerCase(),
    employeeNumber: staff.employeeNumber,
    staffName: staff.employeeName,
    storeName: staff.storeName,
    brand: staff.brand ?? null,
    canaryFlag: staff.canaryFlag ?? null,
    storeIdNew: staff.storeIdNew ?? null,
    region: staff.region ?? null,
  };
}

function buildApiBody(
  context: WpsSessionContext,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...payload,
    staffId: context.staffId,
    storeId: context.storeId,
    countryCode: context.countryCode,
  };

  // Regional WPS deployments require path/region (country segment is lowercase).
  if (context.brand && context.region) {
    const country = context.country ?? context.countryCode.toLowerCase();
    body.path = `${context.brand}/${country}`;
    body.region = context.region;
    if (context.canaryFlag != null) {
      body.canaryFlag = context.canaryFlag;
    }
    if (context.storeIdNew) {
      body.storeId = context.storeIdNew;
    }
  }

  return body;
}

async function fetchJson<T>(
  path: string,
  cookieHeader: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${config.wpsBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      Cookie: cookieHeader,
      Accept: "application/json, text/plain, */*",
      Origin: config.wpsBaseUrl,
      Referer: `${config.wpsBaseUrl}/calendar`,
      "User-Agent": WPS_USER_AGENT,
    },
    body: body === undefined ? "{}" : JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Schedule service request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function getStaffInfo(cookieHeader: string): Promise<WpsStaffInfo> {
  const data = await fetchJson<unknown>("/account/info", cookieHeader);
  const result = requireResult<WpsStaffInfo>(data, "Session check failed");
  if (result.errInfo.status !== 0 || !result.data.staffId) {
    throw new Error("Your session expired. Please sign in again.");
  }
  return result.data;
}

export async function initializeSession(cookieHeader: string): Promise<WpsSessionContext> {
  const staff = await getStaffInfo(cookieHeader);
  const calendarStaffId = await resolveCalendarStaffId(
    cookieHeader,
    staff.employeeNumber,
  );
  return staffInfoToContext(
    cookieHeader,
    applyCalendarStaffId(staff, cookieHeader, calendarStaffId),
  );
}

export async function fetchCalendarMonth(
  context: WpsSessionContext,
  month: string,
): Promise<WpsCalendarData> {
  const data = await fetchJson<unknown>(
    "/api/Calendar",
    context.cookieHeader,
    buildApiBody(context, { month }),
  );
  const result = requireResult<WpsCalendarData>(data, "Calendar fetch failed");
  if (result.errInfo.status !== 0) {
    throw new Error(`Could not load schedule: ${result.errInfo.errCode ?? result.errInfo.status}`);
  }
  return result.data;
}

export async function validateSession(cookieHeader: string): Promise<boolean> {
  try {
    await initializeSession(cookieHeader);
    return true;
  } catch {
    return false;
  }
}

function cookiesToHeader(cookies: WpsCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function staffFromCookies(cookies: WpsCookie[], employeeNumber: string): Partial<WpsStaffInfo> {
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

async function buildSession(cookieHeader: string, employeeNumber = ""): Promise<WpsSession> {
  try {
    const context = await initializeSession(cookieHeader);
    return {
      cookieHeader,
      employeeNumber: context.employeeNumber,
      staffName: context.staffName,
      storeName: context.storeName,
      context,
    };
  } catch {
    const fallback = staffFromCookies(
      cookieHeader.split(";").map((part) => {
        const eq = part.indexOf("=");
        return {
          name: part.slice(0, eq).trim(),
          value: part.slice(eq + 1).trim(),
        } as WpsCookie;
      }),
      employeeNumber,
    );
    if (!fallback.staffId) throw new Error("Your session expired. Please sign in again.");

    const staff = {
      employeeName: "Employee",
      storeName: "Store",
      storeCode: "",
      countryCode: "",
      ...fallback,
    } as WpsStaffInfo;

    const context = staffInfoToContext(cookieHeader, staff);
    return {
      cookieHeader,
      employeeNumber: staff.employeeNumber || employeeNumber,
      staffName: staff.employeeName,
      storeName: staff.storeName,
      context,
    };
  }
}

export function serializeSession(session: WpsSession): string {
  const stored: WpsStoredSession = {
    cookieHeader: session.cookieHeader,
    staffId: String(session.context.staffId),
    storeId: String(session.context.storeId),
    countryCode: session.context.countryCode,
    employeeNumber: session.context.employeeNumber,
  };
  return serializeStoredSession(stored);
}

export async function sessionFromStored(stored: string): Promise<WpsSession> {
  const parsed = deserializeStoredSession(stored);
  return buildSession(parsed.cookieHeader, parsed.employeeNumber ?? "");
}
