export interface WpsLoginUrlData {
  domain: string;
  clientId: string;
  redirectUri: string;
  resource: string;
}

export interface WpsErrInfo {
  status: number;
  errCode: string | null;
}

export interface WpsApiResponse<T> {
  data: T;
  errInfo: WpsErrInfo;
}

/** /account/* endpoints */
export interface WpsWrappedResponse<T> {
  result: WpsApiResponse<T>;
  errInfo: WpsErrInfo;
}

/** /api/* endpoints (e.g. /api/Calendar) */
export interface WpsResResponse<T> {
  res: {
    result: WpsApiResponse<T>;
    errInfo: WpsErrInfo;
  };
}

export interface WpsStaffInfo {
  staffId: number;
  employeeNumber: string;
  employeeName: string;
  storeId: number;
  storeCode: string;
  storeName: string;
  countryCode: string;
  country?: string | null;
  brand?: string | null;
  canaryFlag?: string | null;
  storeIdNew?: number | null;
  region?: string | null;
}

export interface WpsCalendarDay {
  dates: number;
  workSegmentCode: string | null;
  workingTime: string | null;
  clockOutTime: string | null;
  actualTimeStatus: number;
  shiftWorkingTime: string | null;
  shiftClockOutTime: string | null;
  shiftWorkSegmentCode: string | null;
  eventDetail: string | null;
  closeFlag: number;
  shiftConfirmFlag?: number;
}

export interface WpsCalendarData {
  calendarList: WpsCalendarDay[];
  staffName?: string;
  storeName?: string;
  workingDayCount?: number;
  dayOffCount?: number;
  shiftChgReqCount?: number;
  workOfferApplyCount?: number;
  shiftCutoffDate?: string;
}

export interface WorkShift {
  date: string;
  title: string;
  description: string;
  start: Date | null;
  end: Date | null;
  allDay: boolean;
  segmentCode: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
}

export interface UserRecord {
  id: string;
  createdAt: string;
  wpsEmployeeNumber: string | null;
  wpsStaffName: string | null;
  wpsStoreName: string | null;
  wpsConnectedAt: string | null;
  googleConnectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
}

export interface PreviewShift {
  date: string;
  title: string;
  segmentCode: string;
  allDay: boolean;
  startTime: string | null;
  endTime: string | null;
}

export interface SchedulePreview {
  staffName: string;
  storeName: string;
  weekRange: {
    from: string;
    to: string;
    label: string;
  };
  summary: {
    work: number;
    dayOff: number;
    other: number;
    total: number;
  };
  shifts: PreviewShift[];
}

export interface WpsStoredSession {
  cookieHeader: string;
  staffId?: string;
  storeId?: string;
  countryCode?: string;
  employeeNumber?: string;
}

export interface WpsSessionContext {
  cookieHeader: string;
  staffId: number;
  storeId: number;
  countryCode: string;
  country?: string | null;
  employeeNumber: string;
  staffName: string;
  storeName: string;
  brand?: string | null;
  canaryFlag?: string | null;
  storeIdNew?: number | null;
  region?: string | null;
}
