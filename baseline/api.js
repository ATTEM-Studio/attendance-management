const API_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-api';
const DELETE_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-delete';
const REPORT_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-report';
const EMPLOYEE_ADMIN_BASE = 'https://ndczsguqlwyiuqvsmvcb.supabase.co/functions/v1/attendance-employee-admin';
const API_KEY = 'sb_publishable_Zp5OSi4RGo3ZYUXwq22xzA_bpZeaQW-';

async function request(path, { method = 'GET', body, token, timeout = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${API_BASE}/${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: API_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || '처리 중 오류가 발생했습니다.');
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('서버 연결 시간이 초과되었습니다.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function externalRequest(base, { method = 'GET', body, token, timeout = 30000, binary = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(base, {
      method,
      signal: controller.signal,
      headers: {
        apikey: API_KEY,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const err = new Error(data.error || '처리 중 오류가 발생했습니다.');
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return binary ? response.blob() : response.json().catch(() => ({}));
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('서버 연결 시간이 초과되었습니다.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

const api = {
  employeeLogin: (name, pin) => request('employee-login', { method: 'POST', body: { name, pin } }),
  adminLogin: (pin) => request('admin-login', { method: 'POST', body: { pin } }),
  bootstrap: (token, month) => request(`bootstrap?month=${encodeURIComponent(month)}`, { token }),
  logout: (token) => request('logout', { method: 'POST', token }),
  attendance: (token, action, checklistOverrideReason = '') => request('attendance', { method: 'POST', token, body: { action, checklistOverrideReason } }),
  adminAttendance: (token, employeeId, action, checklistOverrideReason = '') => request('admin-attendance', { method: 'POST', token, body: { employeeId, action, checklistOverrideReason } }),
  completeTask: (token, taskAssignmentId) => request('task-complete', { method: 'POST', token, body: { taskAssignmentId } }),
  addEmployee: (token, payload) => request('employee', { method: 'POST', token, body: payload }),
  setEmployeeStatus: (token, employeeId, active) => request('employee-status', { method: 'POST', token, body: { employeeId, active } }),
  updateEmployee: (token, payload) => externalRequest(EMPLOYEE_ADMIN_BASE, { method: 'POST', token, body: { action:'update', ...payload } }),
  deleteEmployee: (token, employeeId) => externalRequest(EMPLOYEE_ADMIN_BASE, { method: 'POST', token, body: { action:'delete', employeeId } }),
  bulkSchedule: (token, payload) => request('schedules/bulk', { method: 'POST', token, body: payload }),
  deleteSchedule: (token, employeeId, workDate, force = false) => request('schedule/delete', { method: 'POST', token, body: { employeeId, workDate, force } }),
  assignTask: (token, payload) => request('task-assignment', { method: 'POST', token, body: payload }),
  updateTask: (token, payload) => request('task-assignment-update', { method: 'POST', token, body: payload }),
  saveChecklistTemplate: (token, payload) => request('checklist-template/save', { method: 'POST', token, body: payload }),
  deleteChecklistTemplate: (token, templateId) => request('checklist-template/delete', { method: 'POST', token, body: { templateId } }),
  correctAttendance: (token, payload) => request('correction', { method: 'POST', token, body: payload }),
  deleteAttendance: (token, attendanceId, reason) => externalRequest(DELETE_BASE, { method: 'POST', token, body: { attendanceId, reason } }),
  downloadAttendanceReport: (token, month) => externalRequest(`${REPORT_BASE}?month=${encodeURIComponent(month)}`, { token, timeout: 60000, binary: true }),
};
