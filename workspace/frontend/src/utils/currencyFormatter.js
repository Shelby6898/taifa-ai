/**
 * Function to format currency amounts in a given locale.
 *
 * @param {number} amount - The currency amount to be formatted.
 * @param {string} currencySymbol - The currency code (e.g., 'USD', 'EUR').
 * @returns {string} The formatted currency string.
 */
export function formatCurrency(amount, currencySymbol) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencySymbol
  }).format(amount);
}
