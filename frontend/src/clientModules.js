/**
 * Module definitions for client access control.
 * Backend DEFAULT_CLIENT_ALLOWED_MODULES must match a subset of these ids.
 */
export const CLIENT_MODULES = [
  { id: 'home', label: 'Home Page', paths: ['/', '/eta-calendar'] },
  { id: 'ticket_dashboard', label: 'Ticket Dashboard', paths: ['/dashboard', '/ticket'] },
  { id: 'tickets', label: 'Tickets Overview', paths: ['/tickets'] },
  { id: 'all_bugs', label: 'All Bugs Dashboard', paths: ['/all-bugs'] },
  { id: 'calendar', label: 'Calendar', paths: ['/calendar'] },
  { id: 'timesheet', label: 'Timesheet', paths: ['/timesheet'] },
  { id: 'qa_cycle', label: 'QA Cycle Dashboard', paths: ['/qa-cycle'] },
  { id: 'automation', label: 'Automation Coverage', paths: ['/automation'] },
];

const pathsByModuleId = new Map(CLIENT_MODULES.map((m) => [m.id, m.paths]));

/** Return true if the given path is allowed for the given list of module ids. */
export function isPathAllowedForClient(path, allowedModuleIds) {
  if (!allowedModuleIds || !Array.isArray(allowedModuleIds)) return false;
  for (const id of allowedModuleIds) {
    const paths = pathsByModuleId.get(id);
    if (paths && paths.includes(path)) return true;
  }
  return false;
}
