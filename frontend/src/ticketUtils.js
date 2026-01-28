export const TICKET_TRACKING_BASE_URL = 'https://www.bissafety.app/pm/tickets#!/';

export const isNumericTicketId = (ticketId) => {
  if (ticketId === null || ticketId === undefined) return false;
  return /^\d+$/.test(String(ticketId).trim());
};

export const getTicketTrackingUrl = (ticketId) => {
  if (!isNumericTicketId(ticketId)) return null;
  return `${TICKET_TRACKING_BASE_URL}${String(ticketId).trim()}`;
};

export const TicketExternalLink = ({ ticketId, className = '', title = 'Open in BIS' }) => {
  const url = getTicketTrackingUrl(ticketId);
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`ticket-external-link ${className}`.trim()}
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 3h7v7" />
        <path d="M10 14L21 3" />
        <path d="M21 14v7h-7" />
        <path d="M3 10V3h7" />
        <path d="M3 21h7v-7" />
      </svg>
    </a>
  );
};
