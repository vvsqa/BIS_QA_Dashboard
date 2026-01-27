/**
 * Date formatting utilities for the QA Dashboard
 * Standard format: DD-MMM-YYYY (e.g., 27-Jan-2026)
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a date to DD-MMM-YYYY format
 * @param {Date|string|number} date - The date to format
 * @returns {string} Formatted date string (e.g., "27-Jan-2026")
 */
export const formatDisplayDate = (date) => {
  if (!date) return '-';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  
  return `${day}-${month}-${year}`;
};

/**
 * Format a date to DD-MMM-YYYY HH:MM format
 * @param {Date|string|number} date - The date to format
 * @returns {string} Formatted datetime string (e.g., "27-Jan-2026 14:30")
 */
export const formatDisplayDateTime = (date) => {
  if (!date) return '-';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

/**
 * Format a date for API calls (YYYY-MM-DD)
 * @param {Date} date - The date to format
 * @returns {string} ISO date string (e.g., "2026-01-27")
 */
export const formatAPIDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Format a date with weekday: Ddd, DD-MMM-YYYY
 * @param {Date|string|number} date - The date to format
 * @returns {string} Formatted date string (e.g., "Mon, 27-Jan-2026")
 */
export const formatDisplayDateWithDay = (date) => {
  if (!date) return '-';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = weekdays[d.getDay()];
  const day = String(d.getDate()).padStart(2, '0');
  const month = MONTHS[d.getMonth()];
  const year = d.getFullYear();
  
  return `${weekday}, ${day}-${month}-${year}`;
};

/**
 * Format time only: HH:MM
 * @param {Date|string|number} date - The date to format
 * @returns {string} Formatted time string (e.g., "14:30")
 */
export const formatTime = (date) => {
  if (!date) return '-';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  
  return `${hours}:${minutes}`;
};

/**
 * Format month and year: MMM YYYY
 * @param {Date|string|number} date - The date to format
 * @returns {string} Formatted string (e.g., "January 2026")
 */
export const formatMonthYear = (date) => {
  if (!date) return '-';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
};

/**
 * Format date range: DD-MMM to DD-MMM-YYYY
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {string} Formatted range (e.g., "20-Jan to 26-Jan-2026")
 */
export const formatDateRange = (startDate, endDate) => {
  if (!startDate || !endDate) return '-';
  
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return '-';
  
  const startDay = String(start.getDate()).padStart(2, '0');
  const startMonth = MONTHS[start.getMonth()];
  const endDay = String(end.getDate()).padStart(2, '0');
  const endMonth = MONTHS[end.getMonth()];
  const endYear = end.getFullYear();
  
  // If same month and year, don't repeat
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${startDay} to ${endDay}-${endMonth}-${endYear}`;
  }
  
  return `${startDay}-${startMonth} to ${endDay}-${endMonth}-${endYear}`;
};
