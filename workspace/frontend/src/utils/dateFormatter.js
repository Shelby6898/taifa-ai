/**
 * Utility function to format dates
 */

export function formatDate(date) {
  if (!date) return null;
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}