/**
 * Function to format currency amounts in a given locale.
 *
 * @param {number} amount - The currency amount to be formatted.
 * @param {string} currencySymbol - The symbol for the currency (e.g., '€', '$').
 * @returns {string} The formatted currency string.
 */
function formatCurrency(amount, currencySymbol) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencySymbol
  }).format(amount);
}

// Example usage:
const amount = 123456.78;
const currencySymbol = '$';
console.log(formatCurrency(amount, currencySymbol)); // Output: $123,456.78