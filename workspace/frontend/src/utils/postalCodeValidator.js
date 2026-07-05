/**
 * Validates a postal code based on specific rules.
 *
 * @param {string} postalCode - The postal code to validate.
 * @return {boolean} True if the postal code is valid, false otherwise.
 */
export function validatePostalCode(postalCode) {
  const postalCodeRegex = /^[0-9]{5}$/;
  return postalCodeRegex.test(postalCode);
}
